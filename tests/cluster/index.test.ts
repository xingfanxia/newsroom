/**
 * Unit tests for workers/cluster/index.ts (Stage A tuning — Task 2.a).
 *
 * These are pure string/logic tests — no DB connection required.
 * We read the source file and assert on the literal SQL text to verify
 * the four Stage A changes without spinning up a database.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// Read the worker source once; all assertions are string searches.
// Use fileURLToPath for ESM+TSC compatibility (import.meta.dir is Bun-only).
const __dirname = dirname(fileURLToPath(import.meta.url));
const workerSrc = readFileSync(
  resolve(__dirname, "../../workers/cluster/index.ts"),
  "utf8",
);

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
    expect(workerSrc).toContain(
      "SELECT embedding, published_at FROM items WHERE id =",
    );
  });

  it("uses BETWEEN … make_interval for bidirectional window", () => {
    expect(workerSrc).toContain("i.published_at BETWEEN");
    expect(workerSrc).toContain("make_interval(hours =>");
  });

  it("does NOT use now() as the window anchor", () => {
    // The old query used `now() - make_interval(hours => ...)`.
    // After the rewrite the anchor comes from target.published_at.
    expect(workerSrc).not.toContain("now() - make_interval");
  });

  it("lower bound subtracts WINDOW_HOURS from target published_at", () => {
    expect(workerSrc).toContain(
      "(SELECT published_at FROM target) - make_interval(hours =>",
    );
  });

  it("upper bound adds WINDOW_HOURS to target published_at", () => {
    expect(workerSrc).toContain(
      "(SELECT published_at FROM target) + make_interval(hours =>",
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

// ── Cluster member-add: latest_member_at + coverage sync ─────────────────────

describe("Cluster UPDATE on member join", () => {
  it("sets latestMemberAt on member join", () => {
    expect(workerSrc).toContain("latestMemberAt: new Date()");
  });

  it("updates coverage to match new memberCount", () => {
    // coverage is kept in sync with the incremented memberCount
    expect(workerSrc).toContain("coverage: sql`${clusters.memberCount} + 1`");
  });

  it("memberCount is still incremented by 1", () => {
    expect(workerSrc).toContain("memberCount: sql`${clusters.memberCount} + 1`");
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
    expect(workerSrc).toContain("nearestRows[0]");
  });
});

// ── Race safety: neighbor-promotion path ─────────────────────────────────────

describe("Neighbor-promotion race safety", () => {
  it("creates the shared cluster with memberCount=0 (not 1) so a stolen neighbor doesn't leave a phantom +1", () => {
    // Before this fix: insert with memberCount=1 (assuming neighbor will join),
    // then itemId join +1 → 2 even when the neighbor was claimed by a concurrent
    // worker. After the fix: start at 0, only bump when the neighbor claim
    // returns rows.
    expect(workerSrc).toContain(
      ".values({ leadItemId: nearest.id, memberCount: 0 })",
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
