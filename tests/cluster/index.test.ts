/**
 * Unit tests for workers/cluster/index.ts (Stage A tuning — Task 2.a).
 *
 * These are pure string/logic tests — no DB connection required.
 * We read the source file and assert on the literal SQL text to verify
 * the four Stage A changes without spinning up a database.
 */
import { describe, expect, it } from "bun:test";
import {
  hasReachedSplitRejectionCap,
  MAX_DISTINCT_SPLIT_RETRIES_PER_ITEM,
} from "@/workers/cluster/split-audit";
import { resolveJoinOutcome, PREFER_CLUSTERED_SLACK } from "@/workers/cluster";
import { readSource } from "@/tests/helpers/source";

// Stage A cosine-distance join threshold (1 - 0.75 similarity).
const T = 0.25;

// Read the worker source once; all assertions are string searches.
const workerSrc = readSource("workers/cluster/index.ts");

// ── Constants ────────────────────────────────────────────────────────────────

describe("Stage A constants", () => {
  it("SIMILARITY_THRESHOLD is 0.75 (lowered from 0.80 to catch cross-source coverage)", () => {
    expect(workerSrc).toContain("const SIMILARITY_THRESHOLD = 0.75;");
  });

  it("WINDOW_HOURS is 72 (extended from 48)", () => {
    expect(workerSrc).toContain("const WINDOW_HOURS = 72;");
  });
});

// ── Threshold logic (cosine distance) ────────────────────────────────────────

describe("Threshold distance conversion", () => {
  /**
   * The worker converts sim → distance: threshold = 1 - SIMILARITY_THRESHOLD.
   * At 0.75 sim threshold the distance threshold is 0.25.
   * Cross-source coverage (TechCrunch / Bloomberg / Verge of the same launch)
   * sits at sim 0.76-0.77 (distance 0.23-0.24) — newly merged.
   * Genuinely different angles (Reddit spec discussion vs press release)
   * sit at sim 0.51 (distance 0.49) — still separate.
   */
  const SIMILARITY_THRESHOLD = 0.75;
  const distanceThreshold = 1 - SIMILARITY_THRESHOLD; // 0.25

  it("distance threshold is 0.25 for sim threshold 0.75", () => {
    expect(distanceThreshold).toBeCloseTo(0.25, 10);
  });

  it("cosine similarity 0.77 → distance 0.23 passes threshold (≤ 0.25)", () => {
    const distance = 1 - 0.77;
    expect(distance).toBeLessThanOrEqual(distanceThreshold);
  });

  it("cosine similarity 0.51 (different-angle Reddit spec) does NOT pass", () => {
    const distance = 1 - 0.51;
    expect(distance).toBeGreaterThan(distanceThreshold);
  });

  it("cosine similarity 0.88 still passes the new threshold", () => {
    const distance = 1 - 0.88;
    expect(distance).toBeLessThanOrEqual(distanceThreshold);
  });

  it("cosine similarity exactly 0.75 passes (boundary)", () => {
    const distance = 1 - 0.75;
    expect(distance).toBeLessThanOrEqual(distanceThreshold);
  });
});

// ── SQL: published_at anchoring ───────────────────────────────────────────────

describe("Neighbor SQL — published_at window anchor", () => {
  it("CTE selects published_at alongside embedding", () => {
    expect(workerSrc).toMatch(
      /WITH target AS \([\s\S]+?SELECT[\s\S]+?embedding,[\s\S]+?published_at/,
    );
  });

  it("uses BETWEEN … ms-window arithmetic for bidirectional window", () => {
    expect(workerSrc).toContain("i.published_at BETWEEN");
    expect(workerSrc).toContain("WINDOW_HOURS * 3_600_000");
  });

  it("does NOT use the current time as the window anchor", () => {
    // The old query used a now-relative window. After the rewrite the
    // anchor comes from target.published_at.
    expect(workerSrc).not.toContain("Date.now() - windowMs");
  });

  it("lower bound subtracts WINDOW_HOURS from target published_at", () => {
    expect(workerSrc).toContain(
      "(SELECT published_at FROM target) - ${windowMs}",
    );
  });

  it("upper bound adds WINDOW_HOURS to target published_at", () => {
    expect(workerSrc).toContain(
      "(SELECT published_at FROM target) + ${windowMs}",
    );
  });
});

// ── SQL: Stage B verified items remain JOINABLE ─────────────────────────────

describe("Neighbor SQL — verified items must be joinable", () => {
  it("WHERE clause does NOT exclude cluster_verified_at IS NOT NULL rows", () => {
    // An earlier version filtered `AND i.cluster_verified_at IS NULL` to
    // protect Stage B's verify-lock. But Stage A only ADDS members — never
    // splits or reshuffles — so the filter was protective theater that
    // turned every verified cluster into a recall black hole: the next
    // item about the same event couldn't see the cluster and spawned a
    // singleton. The fix: drop the filter and rely on the structural
    // invariant (Stage A is add-only).
    expect(workerSrc).not.toContain("AND i.cluster_verified_at IS NULL");
  });
});

// ── SQL: Stage B split audit is a negative edge ─────────────────────────────

describe("Neighbor SQL — split audit exclusions", () => {
  it("does not rejoin an item to a cluster Stage B already rejected", () => {
    expect(workerSrc).toContain("FROM cluster_splits split_audit");
    expect(workerSrc).toContain("split_audit.item_id = ${itemId}");
    expect(workerSrc).toContain(
      "split_audit.from_cluster_id = i.cluster_id",
    );
  });

  it("stops fuzzy-joining items after several distinct split rejections", () => {
    expect(workerSrc).toContain(
      "count(DISTINCT split_audit.from_cluster_id)",
    );
    expect(workerSrc).toContain("hasReachedSplitRejectionCap");
  });

  it("keeps split-cap items as terminal singletons before any nearest-neighbor query", () => {
    const capCheckIdx = workerSrc.indexOf(
      "hasReachedSplitRejectionCap(rejectedClusterCount)",
    );
    const nearestQueryIdx = workerSrc.indexOf("const nearestClusteredResult");

    expect(capCheckIdx).toBeGreaterThan(0);
    expect(nearestQueryIdx).toBeGreaterThan(capCheckIdx);
    expect(workerSrc.slice(capCheckIdx, nearestQueryIdx)).toContain(
      "createSingletonCluster(client, itemId)",
    );
  });

  it("treats the split retry cap as inclusive", () => {
    expect(
      hasReachedSplitRejectionCap(MAX_DISTINCT_SPLIT_RETRIES_PER_ITEM - 1),
    ).toBe(false);
    expect(
      hasReachedSplitRejectionCap(MAX_DISTINCT_SPLIT_RETRIES_PER_ITEM),
    ).toBe(true);
    expect(
      hasReachedSplitRejectionCap(MAX_DISTINCT_SPLIT_RETRIES_PER_ITEM + 1),
    ).toBe(true);
  });
});

// ── SQL: excluded items do not enter event clustering ───────────────────────

describe("Neighbor SQL — visible tier gate", () => {
  it("derives Stage A candidate eligibility from VISIBLE_ITEM_TIERS", () => {
    expect(workerSrc).toContain("VISIBLE_ITEM_TIERS");
    expect(workerSrc).toContain("inArray(items.tier, VISIBLE_ITEM_TIERS)");
  });

  it("filters both clustered and unclustered neighbor queries to visible tiers", () => {
    const visibleNeighborFilters =
      workerSrc.match(/visibleTierInSql\(sql`i\.tier`\)/g) ?? [];

    expect(workerSrc).toContain("visibleTierInSql");
    expect(visibleNeighborFilters).toHaveLength(2);
  });
});

// ── Cluster member-add: latest_member_at + coverage sync ─────────────────────

describe("Cluster UPDATE on member join", () => {
  it("sets latestMemberAt on member join", () => {
    expect(workerSrc).toContain("latestMemberAt: new Date()");
  });

  it("increments coverage in lockstep with memberCount (not recomputed from it)", () => {
    // coverage moves by the same delta as memberCount. The old form
    // `coverage = member_count + 1` recomputed coverage from member_count and
    // non-deterministically half-healed drift (audit W3); lockstep `+ 1` on
    // coverage itself is the fix.
    expect(workerSrc).toContain("coverage: sql`${clusters.coverage} + 1`");
    expect(workerSrc).not.toContain("coverage: sql`${clusters.memberCount} + 1`");
  });

  it("memberCount is still incremented by 1", () => {
    expect(workerSrc).toContain("memberCount: sql`${clusters.memberCount} + 1`");
  });

  it("wraps the item-claim + member_count bump in a transaction (atomic bookkeeping)", () => {
    // Two autocommit statements let a crash land between claim and bump and
    // drift member_count forever (clusters have no self-heal). The claim +
    // bump now run inside a retryTransaction (SQLITE_BUSY-retried, W7a). (T4)
    expect(workerSrc).toContain("retryTransaction(client, async (tx)");
    expect(workerSrc).toMatch(
      /retryTransaction\(client, async \(tx\)[\s\S]+?tx[\s\S]+?\.update\(items\)[\s\S]+?\.update\(clusters\)/,
    );
  });
});

// ── Result-row extraction (regression test for the singleton bug) ────────────

describe("Nearest-neighbor result extraction", () => {
  it("indexes the result as an array, not via a non-existent .rows property", () => {
    // postgres-js's drizzle adapter returns RowList<T> which extends Array<T>;
    // there is no .rows field. The previous (buggy) code used
    //   (nearestResult as { rows?: unknown[] }).rows?.[0]
    // which always evaluated to `undefined`, so EVERY item took the singleton
    // path regardless of its actual nearest-neighbor distance. That silently
    // turned the entire cluster pipeline into a no-op (all member_count=1).
    expect(workerSrc).not.toContain("(nearestResult as { rows?: unknown[] })");
    expect(workerSrc).not.toContain(".rows?.[0]");
    // drizzle-libsql's client.all<T>() returns a typed array directly.
    expect(workerSrc).toContain("nearestClusteredResult[0]");
  });
});

// ── Two-pass nearest-neighbor with prefer-clustered bias ─────────────────────

describe("Prefer-clustered bias (clone-cluster prevention)", () => {
  it("runs a clustered-only nearest-neighbor query (cluster_id IS NOT NULL)", () => {
    // Before this fix: a single nearest-neighbor query returned the global top-1
    // regardless of cluster status. When two near-duplicate items from the same
    // batch were each other's nearest (e.g., two Bloomberg articles about the
    // same launch, distance 0.047), they paired with each other into a NEW
    // cluster — never seeing an older, already-clustered Hacker News item about
    // the same event at distance 0.060. Result: 6 items about Google → Anthropic
    // $40B split across 3 sibling-source clusters that Stage A could never
    // merge (Stage A is append-only, no cluster-merge verdict).
    //
    // Fix: split the lookup. First find the nearest CLUSTERED item; only fall
    // back to the unclustered query if that one is out of threshold.
    expect(workerSrc).toContain("AND i.cluster_id IS NOT NULL");
  });

  it("runs an unclustered-only fallback query (cluster_id IS NULL)", () => {
    // The fallback handles the legitimate case of two new items arriving with
    // no existing cluster about their topic — they should still pair into a
    // new shared cluster, exactly like before.
    expect(workerSrc).toContain("AND i.cluster_id IS NULL");
  });

  it("skips the unclustered query only when a strong (non-borderline) clustered match already wins", () => {
    // Saves one HNSW probe when the clustered join is solid; a borderline
    // clustered match (W4b) or a cohesion-failed one still runs it.
    expect(workerSrc).toMatch(
      /clusteredJoinOk && !clusteredBorderline[\s\S]+?\? null[\s\S]+?await client\.all<\{ id: number; distance: number \}>\(sql`/,
    );
  });

  it("prefers a clustered join over promotion via resolveJoinOutcome (bias order)", () => {
    // The dispatch checks join-clustered BEFORE promote-unclustered — the bias
    // that fixes the clone-cluster bug (clustered wins, bounded by W4b). The
    // decision itself is unit-tested in resolveJoinOutcome; here we just assert
    // the wiring routes clustered first.
    expect(workerSrc).toMatch(
      /if \(outcome === "join-clustered"\)[\s\S]+?if \(outcome === "promote-unclustered"\)/,
    );
  });

  it("documents the bias rule and its rationale", () => {
    // The rationale must mention what the bias trades off (best-mate optimality)
    // for what it gains (cross-cluster recall) — without the why, future
    // maintainers will revert this thinking it's a regression.
    expect(workerSrc).toContain("cross-cluster recall");
    expect(workerSrc).toContain("Prefer-clustered slack");
  });
});

// ── Race safety: neighbor-promotion path ─────────────────────────────────────

describe("Neighbor-promotion race safety", () => {
  it("creates the shared cluster with memberCount=0 (not 1) so a stolen neighbor doesn't leave a phantom +1", () => {
    // Before this fix: insert with memberCount=1 (assuming neighbor will join),
    // then itemId join +1 → 2 even when the neighbor was claimed by a concurrent
    // worker. After the fix: start at 0, only bump when the neighbor claim
    // returns rows. coverage starts at 0 too so it's in lockstep from birth.
    expect(workerSrc).toContain(
      ".values({ leadItemId: nearestUnclustered!.id, memberCount: 0, coverage: 0 })",
    );
  });

  it("wraps the promote-neighbor create+claim+bump in a transaction", () => {
    // insert cluster + claim neighbor + bump were three autocommit statements;
    // a crash between claim and bump drifts member_count. Now one transaction. (T4)
    expect(workerSrc).toMatch(
      /const promoted = await retryTransaction\(client, async \(tx\)/,
    );
  });

  it("checks .returning() on the neighbor claim before incrementing memberCount", () => {
    // The atomic-claim pattern returns 0 rows when a concurrent worker won;
    // we must inspect the returned array length before bumping the counter.
    expect(workerSrc).toContain("neighborClaim.length > 0");
  });

  it("repoints leadItemId to itemId when the neighbor was stolen (no dangling lead)", () => {
    // If we lose the race, the cluster repurposes itself as a singleton for
    // itemId; lead must point to itemId since the original neighbor is now in
    // some other cluster.
    expect(workerSrc).toContain(".set({ leadItemId: itemId })");
  });
});

// ── resolveJoinOutcome: pure W5.1 cohesion gate + W4b prefer-clustered bound ──

describe("resolveJoinOutcome (W5.1 + W4b)", () => {
  it("joins a within-threshold clustered neighbor whose lead is within cohesion", () => {
    expect(
      resolveJoinOutcome({
        clusteredDistance: 0.1,
        leadDistance: 0.2,
        unclusteredDistance: null,
        threshold: T,
      }),
    ).toBe("join-clustered");
  });

  it("W5.1: rejects the clustered join when the lead is beyond cohesion, falling back to a twin", () => {
    // lead 0.5 > COHESION_MAX_DISTANCE 0.35 → not a valid join target.
    expect(
      resolveJoinOutcome({
        clusteredDistance: 0.1,
        leadDistance: 0.5,
        unclusteredDistance: 0.1,
        threshold: T,
      }),
    ).toBe("promote-unclustered");
  });

  it("W5.1: a cohesion-failed clustered neighbor with no twin becomes a singleton", () => {
    expect(
      resolveJoinOutcome({
        clusteredDistance: 0.1,
        leadDistance: 0.5,
        unclusteredDistance: null,
        threshold: T,
      }),
    ).toBe("singleton");
  });

  it("W5.1: no lead embedding (null lead distance) fails cohesion", () => {
    expect(
      resolveJoinOutcome({
        clusteredDistance: 0.1,
        leadDistance: null,
        unclusteredDistance: null,
        threshold: T,
      }),
    ).toBe("singleton");
  });

  it("W4b: a much-closer unclustered twin beats a borderline clustered match", () => {
    // clustered 0.24, twin 0.02 → 0.24 > 0.02 + 0.05 slack → twin wins.
    expect(
      resolveJoinOutcome({
        clusteredDistance: 0.24,
        leadDistance: 0.2,
        unclusteredDistance: 0.02,
        threshold: T,
      }),
    ).toBe("promote-unclustered");
  });

  it("W4b: the prefer-clustered bias holds when the twin is only slightly closer", () => {
    // clustered 0.24, twin 0.21 → 0.24 <= 0.21 + 0.05 → clustered still wins.
    expect(
      resolveJoinOutcome({
        clusteredDistance: 0.24,
        leadDistance: 0.2,
        unclusteredDistance: 0.21,
        threshold: T,
      }),
    ).toBe("join-clustered");
  });

  it("promotes an unclustered twin when there is no clustered neighbor", () => {
    expect(
      resolveJoinOutcome({
        clusteredDistance: null,
        leadDistance: null,
        unclusteredDistance: 0.1,
        threshold: T,
      }),
    ).toBe("promote-unclustered");
  });

  it("skipped unclustered scan (null) on a strong clustered match still joins clustered", () => {
    // Caller skips the second scan when the clustered match is strong; null
    // reads as 'no twin' and correctly yields join-clustered.
    expect(
      resolveJoinOutcome({
        clusteredDistance: 0.1,
        leadDistance: 0.2,
        unclusteredDistance: null,
        threshold: T,
      }),
    ).toBe("join-clustered");
  });

  it("nothing within threshold → singleton", () => {
    expect(
      resolveJoinOutcome({
        clusteredDistance: 0.4,
        leadDistance: 0.2,
        unclusteredDistance: 0.5,
        threshold: T,
      }),
    ).toBe("singleton");
  });

  it("W4b: the prefer-clustered slack constant matches the tested scenarios", () => {
    // The bias cases above hardcode a 0.05 gap (0.24 vs 0.21 holds, 0.24 vs
    // 0.02 breaks). Pin the constant so a retune flags those scenarios for
    // review instead of silently drifting past them.
    expect(PREFER_CLUSTERED_SLACK).toBe(0.05);
  });
});
