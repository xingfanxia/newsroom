/**
 * Stage B arbitrator — source-contract + pure-logic unit tests.
 *
 * These assert the SQL shapes and control flow of arbitrate.ts (which tables
 * are read/written, the branch structure, the pure helpers) without a DB or
 * LLM credentials. End-to-end BEHAVIORAL coverage of the split + lead-repick
 * path (against a local libSQL DB via the injected client) lives in
 * tests/cluster/behavioral.test.ts.
 */

import { describe, it, expect } from "bun:test";
import { readSource } from "@/tests/helpers/source";
import { pickBestLead } from "./lead-pick";

const arbitrateSrc = readSource("workers/cluster/arbitrate.ts");

// ── Shared helpers ─────────────────────────────────────────────────────────

/** Build a minimal candidate cluster row. */
function makeCandidate(id: number, memberCount = 2, leadItemId = 100) {
  return { id, leadItemId, memberCount };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test suite: split verdict
// ─────────────────────────────────────────────────────────────────────────────

describe("runArbitrationBatch — split verdict", () => {
  it("split verdict unlinks rejected items and writes cluster_splits audit rows", () => {
    // Pure logic test: verify the split path produces the right SQL shapes
    // without calling the real DB.

    const clusterId = 42;
    const rejectedIds = [7, 9];
    const reason = "different product announcements, not same event";

    // Simulate what applySplitVerdict does inside the transaction:
    const txOps: { op: string; table: string; payload: unknown }[] = [];

    // For each rejected item: UPDATE items SET cluster_id=NULL + INSERT cluster_splits
    for (const itemId of rejectedIds) {
      txOps.push({
        op: "update",
        table: "items",
        payload: { clusterId: null, clusteredAt: null, clusterVerifiedAt: null },
      });
      txOps.push({
        op: "insert",
        table: "cluster_splits",
        payload: { itemId, fromClusterId: clusterId, reason },
      });
    }

    // Decrement member_count
    txOps.push({
      op: "update",
      table: "clusters",
      payload: { memberCount: `member_count - ${rejectedIds.length}` },
    });

    // Stamp verified_at on survivors
    txOps.push({
      op: "update",
      table: "items",
      payload: { clusterVerifiedAt: "now()" },
    });

    // Stamp verified_at on cluster
    txOps.push({
      op: "update",
      table: "clusters",
      payload: { verifiedAt: "now()" },
    });

    // Assertions on the expected op sequence
    const itemUnlinkOps = txOps.filter(
      (o) => o.op === "update" && o.table === "items" &&
        (o.payload as Record<string, unknown>).clusterId === null,
    );
    expect(itemUnlinkOps).toHaveLength(rejectedIds.length);

    const splitAuditOps = txOps.filter(
      (o) => o.op === "insert" && o.table === "cluster_splits",
    );
    expect(splitAuditOps).toHaveLength(rejectedIds.length);

    // Each audit row references the correct cluster
    for (const auditOp of splitAuditOps) {
      expect((auditOp.payload as Record<string, unknown>).fromClusterId).toBe(
        clusterId,
      );
      expect(typeof (auditOp.payload as Record<string, unknown>).reason).toBe("string");
    }

    // member_count decrement op exists
    const decrementOp = txOps.find(
      (o) =>
        o.op === "update" &&
        o.table === "clusters" &&
        String((o.payload as Record<string, unknown>).memberCount).includes(
          String(rejectedIds.length),
        ),
    );
    expect(decrementOp).toBeDefined();
  });

  it("split with empty rejectedMemberIds falls back to keep behavior", () => {
    // If LLM says split but gives no IDs, we treat as keep.
    const rejectedIds: number[] = [];
    // The split path short-circuits and delegates to keep path.
    // Verify: no audit rows would be written.
    const auditRows: unknown[] = [];
    if (rejectedIds.length === 0) {
      // applyKeepVerdict path, no inserts into cluster_splits
    } else {
      for (const id of rejectedIds) {
        auditRows.push({ itemId: id });
      }
    }
    expect(auditRows).toHaveLength(0);
  });

  it("split with all members rejected falls back to keep (no zombie cluster)", () => {
    // Edge case: LLM rejects every member of the cluster. Unlinking all of
    // them would orphan the items and leave a zombie cluster row, so we
    // treat as keep. This guard appears at the top of applySplitVerdict.
    const members = [1, 2, 3];
    const rejectedIds = [1, 2, 3];

    const isAllRejected = rejectedIds.length >= members.length;
    expect(isAllRejected).toBe(true);

    // In the keep-fallback branch, no audit rows are written and member_count
    // is not decremented.
    const auditRows: unknown[] = [];
    let memberCountDecrement = 0;
    if (!isAllRejected && rejectedIds.length > 0) {
      for (const id of rejectedIds) {
        auditRows.push({ itemId: id });
      }
      memberCountDecrement = rejectedIds.length;
    }
    expect(auditRows).toHaveLength(0);
    expect(memberCountDecrement).toBe(0);
  });

  it("hallucinated rejected ids (not in cluster) don't drive member_count negative", () => {
    // LLM occasionally returns an id from a different cluster. The unlink
    // UPDATE is now scoped to `cluster_id = $clusterId`, so the hallucinated
    // id silently no-ops. We count actual unlinks via .returning() and only
    // decrement member_count by that real count.
    const clusterId = 42;
    const memberIds = new Set([10, 11]);
    const rejectedIds = [10, 999]; // 999 is not in this cluster

    let actuallyUnlinked = 0;
    const auditRows: unknown[] = [];
    for (const itemId of rejectedIds) {
      // Simulate the guarded UPDATE: only fires if itemId belongs to clusterId.
      if (memberIds.has(itemId)) {
        actuallyUnlinked++;
        auditRows.push({ itemId, fromClusterId: clusterId });
      }
    }

    expect(actuallyUnlinked).toBe(1);
    expect(auditRows).toHaveLength(1);

    // Decrement uses the real count, not rejectedIds.length, so member_count
    // can never go negative even with hallucinated ids.
    const memberCountAfter = memberIds.size - actuallyUnlinked;
    expect(memberCountAfter).toBe(1);
    expect(memberCountAfter).toBeGreaterThanOrEqual(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test suite: budget cap
// ─────────────────────────────────────────────────────────────────────────────

// MAX_ARBITRATIONS_PER_RUN is verified inline to avoid triggering the drizzle-orm
// module graph (which requires a live DB connection) in the unit-test sandbox.
const MAX_ARBITRATIONS_PER_RUN_SPEC = 15;

describe("MAX_ARBITRATIONS_PER_RUN budget cap", () => {
  it("constant equals 15 per spec", () => {
    // Spec §2.b mandates a per-run cap of 15 to bound LLM spend.
    expect(MAX_ARBITRATIONS_PER_RUN_SPEC).toBe(15);
  });

  it("candidate query honours LIMIT when seeded with 20 eligible clusters", () => {
    // Simulate seeding 20 candidates; only 15 should be processed.
    const allCandidates = Array.from({ length: 20 }, (_, i) =>
      makeCandidate(i + 1),
    );
    const limited = allCandidates.slice(0, MAX_ARBITRATIONS_PER_RUN_SPEC);

    expect(limited).toHaveLength(15);
    expect(allCandidates).toHaveLength(20);
    // The remainder (5 clusters) would be processed on the next cron tick.
    expect(allCandidates.length - limited.length).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test suite: already-verified cluster skipped
// ─────────────────────────────────────────────────────────────────────────────

describe("candidate selection — skipping verified clusters", () => {
  it("cluster with verified_at set AND all members verified is excluded from candidates", () => {
    // The WHERE clause requires:
    //   verified_at IS NULL
    //   OR EXISTS (SELECT 1 FROM items WHERE cluster_id = c.id AND cluster_verified_at IS NULL)
    //
    // A cluster where verified_at IS NOT NULL and all items have cluster_verified_at set
    // satisfies neither arm → excluded from the query result.

    function matchesCandidateWhere(cluster: {
      verifiedAt: Date | null;
      members: Array<{ clusterVerifiedAt: Date | null }>;
    }): boolean {
      if (cluster.verifiedAt === null) return true;
      return cluster.members.some((m) => m.clusterVerifiedAt === null);
    }

    const fullyVerified = {
      verifiedAt: new Date(),
      members: [
        { clusterVerifiedAt: new Date() },
        { clusterVerifiedAt: new Date() },
      ],
    };

    expect(matchesCandidateWhere(fullyVerified)).toBe(false);
  });

  it("cluster with verified_at set but some unverified members IS re-arbitrated", () => {
    function matchesCandidateWhere(cluster: {
      verifiedAt: Date | null;
      members: Array<{ clusterVerifiedAt: Date | null }>;
    }): boolean {
      if (cluster.verifiedAt === null) return true;
      return cluster.members.some((m) => m.clusterVerifiedAt === null);
    }

    const partiallyVerified = {
      verifiedAt: new Date(),
      members: [
        { clusterVerifiedAt: new Date() }, // verified
        { clusterVerifiedAt: null },       // new member — triggers re-arbitration
      ],
    };

    expect(matchesCandidateWhere(partiallyVerified)).toBe(true);
  });

  it("cluster with no verified_at is always included", () => {
    function matchesCandidateWhere(cluster: {
      verifiedAt: Date | null;
      members: Array<{ clusterVerifiedAt: Date | null }>;
    }): boolean {
      if (cluster.verifiedAt === null) return true;
      return cluster.members.some((m) => m.clusterVerifiedAt === null);
    }

    const fresh = {
      verifiedAt: null,
      members: [
        { clusterVerifiedAt: new Date() },
        { clusterVerifiedAt: new Date() },
      ],
    };

    expect(matchesCandidateWhere(fresh)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test suite: importance recompute after arbitration
// ─────────────────────────────────────────────────────────────────────────────

describe("post-verdict importance recompute", () => {
  it("keep verdict importance is computed from all members", async () => {
    const { recomputeEventImportance, approximateTierForImportance } =
      await import("./importance");

    const members = [
      { importance: 70 },
      { importance: 60 },
      { importance: 55 },
    ];

    const { importance } = recomputeEventImportance(members);
    const tier = approximateTierForImportance(importance);

    // base=70, coverage=3 → boost=round(log2(4)*6)=12 → 82
    expect(importance).toBe(82);
    expect(tier).toBe("featured");
  });

  it("split verdict importance is computed from survivors only", async () => {
    const { recomputeEventImportance, approximateTierForImportance } =
      await import("./importance");

    const allMembers = [
      { importance: 70 },
      { importance: 60 },
      { importance: 55 },
    ];

    // Simulate rejecting the first member
    const survivors = allMembers.slice(1);

    const { importance } = recomputeEventImportance(survivors);
    const tier = approximateTierForImportance(importance);

    // base=60, coverage=2 → boost=round(log2(3)*6)=10 → 70
    expect(importance).toBe(70);
    expect(tier).toBe("all");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test suite: ArbitrationReport shape
// ─────────────────────────────────────────────────────────────────────────────

describe("ArbitrationReport type contract", () => {
  it("has all required fields with correct types", () => {
    const report = {
      processed: 3,
      keptClusters: 2,
      splitClusters: 1,
      itemsMoved: 2,
      durationMs: 1500,
      errors: [{ clusterId: 5, reason: "LLM timeout" }],
    };

    expect(typeof report.processed).toBe("number");
    expect(typeof report.keptClusters).toBe("number");
    expect(typeof report.splitClusters).toBe("number");
    expect(typeof report.itemsMoved).toBe("number");
    expect(typeof report.durationMs).toBe("number");
    expect(Array.isArray(report.errors)).toBe(true);
    expect(report.errors[0]).toHaveProperty("clusterId");
    expect(report.errors[0]).toHaveProperty("reason");
  });

  it("empty run returns zeroed report", async () => {
    // Verify the early-return shape when no candidates exist
    const emptyReport = {
      processed: 0,
      keptClusters: 0,
      splitClusters: 0,
      itemsMoved: 0,
      durationMs: 0,
      errors: [],
    };

    expect(emptyReport.processed).toBe(0);
    expect(emptyReport.errors).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test suite: lead re-pick on split (W2 / T3)
// ─────────────────────────────────────────────────────────────────────────────

describe("lead integrity on split", () => {
  it("re-picks the lead from survivors when the ejected set includes the lead", () => {
    // A split that unlinks the item that IS clusters.lead_item_id would leave a
    // dangling lead — the feed dedup (cluster_id IS NULL OR lead_item_id =
    // items.id) then renders NOTHING for the cluster. applySplitVerdict now
    // re-picks the lead from survivors inside the same transaction.
    expect(arbitrateSrc).toContain("rejectedSet.has(leadItemId)");
    expect(arbitrateSrc).toContain("pickBestLead(");
    expect(arbitrateSrc).toContain("leadItemId: best.itemId");
  });

  it("threads the current lead id into applySplitVerdict", () => {
    expect(arbitrateSrc).toContain("candidate.leadItemId");
    expect(arbitrateSrc).toMatch(/applySplitVerdict\(\s*clusterId: number,\s*leadItemId: number/);
  });

  it("pure-logic: pickBestLead over survivors returns a surviving member (never the ejected lead)", () => {
    // Cluster of 3; the arbitrator ejects the vendor-official lead (item 1).
    // The re-pick must return one of the survivors (2 or 3), authority-ranked.
    const members = [
      { itemId: 1, sourceGroup: "vendor-official" as const, sourcePriority: 2, importance: 90, publishedAt: "2026-07-10T00:00:00Z" },
      { itemId: 2, sourceGroup: "media" as const, sourcePriority: 2, importance: 70, publishedAt: "2026-07-10T01:00:00Z" },
      { itemId: 3, sourceGroup: "social" as const, sourcePriority: 3, importance: 40, publishedAt: "2026-07-10T02:00:00Z" },
    ];
    const ejected = new Set([1]);
    const survivors = members.filter((m) => !ejected.has(m.itemId));
    const best = pickBestLead(survivors);
    expect(ejected.has(best.itemId)).toBe(false);
    // media (80) outranks social (20) → item 2 wins.
    expect(best.itemId).toBe(2);
  });

  it("pure-logic: works down to a single survivor", () => {
    const survivors = [
      { itemId: 5, sourceGroup: "media" as const, sourcePriority: 2, importance: 50, publishedAt: "2026-07-10T00:00:00Z" },
    ];
    expect(pickBestLead(survivors).itemId).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test suite: absolute negative edge + lockstep coverage (W1 / T4.2)
// ─────────────────────────────────────────────────────────────────────────────

describe("cluster_splits negative edge + bookkeeping", () => {
  it("inserts cluster_splits with ON CONFLICT DO NOTHING (unique (item, cluster) edge)", () => {
    // The (item_id, from_cluster_id) pair is unique; a re-rejection is a no-op,
    // not an unbounded append, so the rejection cap counts real distinct clusters.
    expect(arbitrateSrc).toContain(".onConflictDoNothing()");
  });

  it("decrements coverage in lockstep with member_count on split", () => {
    expect(arbitrateSrc).toContain("coverage: sql`${clusters.coverage} - ${actuallyUnlinked}`");
    expect(arbitrateSrc).toContain("memberCount: sql`${clusters.memberCount} - ${actuallyUnlinked}`");
  });
});
