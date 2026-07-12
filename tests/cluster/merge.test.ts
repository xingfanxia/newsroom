/**
 * Unit tests for workers/cluster/merge.ts (Stage B+ duplicate-cluster merge).
 *
 * Pure source-string assertions — no DB needed. Mirrors the style of
 * tests/cluster/index.test.ts.
 */
import { describe, expect, it } from "bun:test";
import { readSource } from "@/tests/helpers/source";

const mergeSrc = readSource("workers/cluster/merge.ts");
const pipelineSrc = readSource("workers/cluster/pipeline.ts");

// ── Threshold constants ─────────────────────────────────────────────────────

describe("Merge thresholds", () => {
  it("MERGE_MIN_DISTANCE = 0.25 (matches Stage A same-event threshold)", () => {
    expect(mergeSrc).toContain("export const MERGE_MIN_DISTANCE = 0.25;");
  });

  it("MERGE_MEAN_DISTANCE = 0.20 (cliff between same-event and topic-similar)", () => {
    // Same-event pairs: ≤ 0.15 (Anthropic-Google 0.091, QbitAI repeats 0.05-0.10).
    // Topic-similar but different events: ≥ 0.21 (different OpenAI launches).
    // 0.20 is the empirical cliff that separates them.
    expect(mergeSrc).toContain("export const MERGE_MEAN_DISTANCE = 0.2;");
  });

  it("MERGE_PAIRS_WITHIN_FRACTION = 0.5 (majority-coherence safety)", () => {
    // Without this, a single shared near-twin in two otherwise-different
    // clusters can drag the MEAN below threshold and trigger a false merge.
    expect(mergeSrc).toContain(
      "export const MERGE_PAIRS_WITHIN_FRACTION = 0.5;",
    );
  });

  it("MERGE_TIME_OVERLAP_HOURS = 72 (item-level published_at overlap)", () => {
    expect(mergeSrc).toContain("const MERGE_TIME_OVERLAP_HOURS = 72;");
  });

  it("documents the calibration warning for embedding-model swaps", () => {
    expect(mergeSrc).toContain("text-embedding-3-large");
    expect(mergeSrc).toContain("re-validated");
  });
});

// ── Candidate-pair SQL ──────────────────────────────────────────────────────

describe("Candidate-pair query", () => {
  it("requires multi-member clusters (member_count >= 2)", () => {
    expect(mergeSrc).toContain("c.member_count >= 2");
  });

  it("uses item-level time overlap, NOT cluster.first_seen_at", () => {
    // Cluster row creation time is when the cluster was first persisted —
    // could be today even if the items inside are months old (backfilled
    // OpenAI blog posts). Item-level published_at is the only safe overlap
    // anchor.
    expect(mergeSrc).toContain("ia.published_at - ib.published_at");
    expect(mergeSrc).not.toContain("a.earliest <=");
    expect(mergeSrc).not.toContain("first_seen_at + make_interval");
  });

  it("filters by all three thresholds (min, mean, fraction)", () => {
    expect(mergeSrc).toContain("min_distance <=");
    expect(mergeSrc).toContain("mean_distance <=");
    expect(mergeSrc).toContain(
      "(CAST(pairs_within AS REAL) / total_pairs) >=",
    );
  });

  it("orders by mean_distance ASC so tightest pairs commit first (transitive merge stability)", () => {
    expect(mergeSrc).toContain("ORDER BY mean_distance ASC");
  });

  it("excludes no-content X-link clusters via canonical-title pattern match", () => {
    // These clusters' embeddings encode "I have no content" rather than a
    // specific event; merging them spawns a meaningless mega-cluster.
    expect(mergeSrc).toContain("未披露");
    expect(mergeSrc).toContain("无法核实");
    expect(mergeSrc).toContain("undisclosed");
    expect(mergeSrc).toContain("unable to verify");
  });
});

// ── Transitive-merge handling (union-find) ──────────────────────────────────

describe("Transitive merge handling", () => {
  it("uses a survivorOf parent map with path-following findSurvivor", () => {
    expect(mergeSrc).toContain("survivorOf");
    expect(mergeSrc).toContain("function findSurvivor");
  });

  it("picks older cluster as survivor (smaller id wins)", () => {
    // First-seen cluster wins. New duplicates fold into established events.
    expect(mergeSrc).toMatch(
      /survivorId < loserId \? \[survivorId, loserId\] : \[loserId, survivorId\]/,
    );
  });

  it("skips already-merged pairs without erroring", () => {
    expect(mergeSrc).toContain("if (survivorId === loserId)");
  });
});

// ── mergeClusters transaction ───────────────────────────────────────────────

describe("Atomic merge transaction", () => {
  it("nulls cluster_verified_at on moved items so Stage B re-arbitrates", () => {
    expect(mergeSrc).toContain("clusterVerifiedAt: null");
  });

  it("resets survivor's verified_at / titled_at / commentary_at", () => {
    // After absorbing a loser, the survivor's pool is bigger. Stages B/C/D
    // need to re-run with the new pool — the prior verdicts/titles/comments
    // are stale.
    expect(mergeSrc).toContain("verifiedAt: null");
    expect(mergeSrc).toContain("titledAt: null");
    expect(mergeSrc).toContain("commentaryAt: null");
  });

  it("bumps memberCount AND coverage by the actual moved-row count", () => {
    // Using returned rowcount (not LLM-supplied size) protects against
    // drift if some rows were already moved by a concurrent run.
    expect(mergeSrc).toContain("memberCount: sql`${clusters.memberCount} + ${movedCount}`");
    expect(mergeSrc).toContain("coverage: sql`${clusters.coverage} + ${movedCount}`");
  });

  it("deletes the loser cluster row inside the transaction", () => {
    expect(mergeSrc).toContain("tx.delete(clusters)");
  });

  it("bumps the winner only when items actually moved (guarded by movedCount > 0)", () => {
    // The loser is empty either way (moved out or unlinked to NULL), so the
    // delete is unconditional; resetting the winner's B/C/D stamps on a no-op
    // move would burn LLM calls for nothing.
    expect(mergeSrc).toContain("if (movedCount > 0)");
  });
});

// ── Split-loop reunite guard (W1) ───────────────────────────────────────────

describe("Merge respects Stage B split negative-edges", () => {
  it("does NOT reunite a loser item the arbitrator rejected from the winner", () => {
    // The historical split-loop vector: a rejected item re-enters the rejecting
    // cluster through any twin cluster that merges in. mergeClusters now unlinks
    // (cluster_id = NULL) loser items that have a cluster_splits row against the
    // WINNER instead of moving them in.
    expect(mergeSrc).toContain("cluster_splits cs");
    expect(mergeSrc).toContain("cs.from_cluster_id = ${winnerId}");
    expect(mergeSrc).toMatch(
      /clusterId: null, clusteredAt: null, clusterVerifiedAt: null[\s\S]+?cluster_splits cs/,
    );
  });

  it("unlinks split-guarded items BEFORE moving the rest into the winner", () => {
    // Order matters: null-out the split-guarded loser items first, then the
    // `cluster_id = loserId` move only catches the remainder.
    const unlinkIdx = mergeSrc.indexOf("cluster_splits cs");
    const moveIdx = mergeSrc.indexOf("Move whatever loser items remain");
    expect(unlinkIdx).toBeGreaterThan(0);
    expect(moveIdx).toBeGreaterThan(unlinkIdx);
  });
});

// ── NULL-title merge eligibility (W5 / T5) ──────────────────────────────────

describe("noContentSkip NULL-guard", () => {
  it("keeps untitled clusters merge-eligible via COALESCE(NOT ..., 1)", () => {
    // An untitled cluster (both canonical titles NULL) makes noContentSkip
    // evaluate to NULL, and bare `NOT NULL` is NULL → the row was silently
    // dropped from merge candidates (SQLite three-valued logic). Merge runs
    // before Stage C titles, so this starved untitled clusters under load.
    expect(mergeSrc).toContain("COALESCE(NOT ${noContentSkip}, 1)");
    expect(mergeSrc).not.toContain("AND NOT ${noContentSkip}");
  });
});

// ── Cron pipeline integration ───────────────────────────────────────────────

describe("Cron stage wiring (Stage B+ between B and C)", () => {
  it("imports runMergeBatch from workers/cluster/merge", () => {
    expect(pipelineSrc).toContain("runMergeBatch");
    expect(pipelineSrc).toContain('from "@/workers/cluster/merge"');
  });

  it("runs merge AFTER arbitrate, BEFORE canonicalTitles", () => {
    // Order matters: arbitrate splits unrelated items first (clean pool),
    // then merge collapses near-duplicate clusters, then canonical-title
    // regenerates names for the larger surviving clusters.
    const arbitrateIdx = pipelineSrc.indexOf("runArbitrationBatch()");
    const mergeIdx = pipelineSrc.indexOf("runMergeBatch(");
    const titlesIdx = pipelineSrc.indexOf("runCanonicalTitleBatch()");
    expect(arbitrateIdx).toBeGreaterThan(0);
    expect(mergeIdx).toBeGreaterThan(arbitrateIdx);
    expect(titlesIdx).toBeGreaterThan(mergeIdx);
  });

  it("scopes merge to a recency window (default 6h) for cron-tick speed", () => {
    expect(pipelineSrc).toContain("MERGE_RECENCY_HOURS = 6");
    expect(pipelineSrc).toContain("recencyHours: MERGE_RECENCY_HOURS");
  });

  it("includes the merge stage report in the JSON response", () => {
    const routeSrc = readSource("app/api/cron/cluster/route.ts");
    expect(routeSrc).toContain("merge: report.merge");
  });
});
