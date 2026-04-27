/**
 * Unit tests for workers/cluster/merge.ts (Stage B+ duplicate-cluster merge).
 *
 * Pure source-string assertions — no DB needed. Mirrors the style of
 * tests/cluster/index.test.ts.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const mergeSrc = readFileSync(
  resolve(__dirname, "../../workers/cluster/merge.ts"),
  "utf8",
);
const cronSrc = readFileSync(
  resolve(__dirname, "../../app/api/cron/cluster/route.ts"),
  "utf8",
);

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
    expect(mergeSrc).toContain("export const MERGE_TIME_OVERLAP_HOURS = 72;");
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
      "(pairs_within::float8 / total_pairs::float8) >=",
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

  it("handles the empty-loser race (concurrent run already moved everything)", () => {
    expect(mergeSrc).toMatch(/movedCount === 0[\s\S]+?tx\.delete\(clusters\)/);
  });
});

// ── Cron pipeline integration ───────────────────────────────────────────────

describe("Cron stage wiring (Stage B+ between B and C)", () => {
  it("imports runMergeBatch from workers/cluster/merge", () => {
    expect(cronSrc).toContain(
      'import { runMergeBatch } from "@/workers/cluster/merge"',
    );
  });

  it("runs merge AFTER arbitrate, BEFORE canonicalTitles", () => {
    // Order matters: arbitrate splits unrelated items first (clean pool),
    // then merge collapses near-duplicate clusters, then canonical-title
    // regenerates names for the larger surviving clusters.
    const arbitrateIdx = cronSrc.indexOf("runArbitrationBatch()");
    const mergeIdx = cronSrc.indexOf("runMergeBatch(");
    const titlesIdx = cronSrc.indexOf("runCanonicalTitleBatch()");
    expect(arbitrateIdx).toBeGreaterThan(0);
    expect(mergeIdx).toBeGreaterThan(arbitrateIdx);
    expect(titlesIdx).toBeGreaterThan(mergeIdx);
  });

  it("scopes merge to a recency window (default 6h) for cron-tick speed", () => {
    expect(cronSrc).toContain("MERGE_RECENCY_HOURS = 6");
    expect(cronSrc).toContain("recencyHours: MERGE_RECENCY_HOURS");
  });

  it("includes the merge stage report in the JSON response", () => {
    expect(cronSrc).toMatch(/at: new Date\(\)\.toISOString\(\)[\s\S]+?merge,/);
  });
});
