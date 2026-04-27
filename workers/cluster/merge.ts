/**
 * Stage B+ merge — collapse near-duplicate multi-member clusters into one.
 *
 * Stage A is greedy and append-only — once two clusters about the same event
 * have formed (e.g., {Bloomberg-A, Bloomberg-B} and {HN-A, HN-B} both about
 * a Google→Anthropic $40B announcement), the pipeline has no per-item path
 * to merge them. The Stage A `prefer-clustered` patch prevents NEW clones;
 * this stage repairs the existing data and catches edge cases where two
 * twin clusters survived Stage A's bias (e.g., HNSW returned an unclustered
 * candidate before any clustered one was indexed).
 *
 * Logic (per pair of multi-member clusters with time-overlapping members):
 *   1. Compute MIN, MEAN, and "fraction within Stage-A-threshold" cosine
 *      distances over cross-cluster (a, b) item pairs whose published_at
 *      values are within MERGE_TIME_OVERLAP_HOURS of each other.
 *   2. If MIN ≤ MERGE_MIN_DISTANCE AND MEAN ≤ MERGE_MEAN_DISTANCE AND the
 *      fraction within ≥ MERGE_PAIRS_WITHIN_FRACTION → merge.
 *   3. Pick the older cluster (smaller id) as survivor; move loser's items
 *      to survivor, null cluster_verified_at on the moved items, reset
 *      survivor.{verified_at, titled_at, commentary_at} so Stages B/C/D
 *      regenerate with the new pool, delete the loser cluster row.
 *
 * Idempotent: re-running on the same window does nothing once merges
 * complete (the loser cluster ids are gone; survivors are already merged).
 *
 * Threshold tuning (current values calibrated for text-embedding-3-large):
 *   MERGE_MIN_DISTANCE = 0.25 — same as Stage A's same-event threshold
 *     (sim ≥ 0.75). At least one cross-pair must look like a Stage-A
 *     same-event match for the merge to even be considered.
 *   MERGE_MEAN_DISTANCE = 0.20 — empirical cliff between "same event"
 *     (Anthropic-Google reference: 0.091; QbitAI repeats: 0.05-0.10;
 *     same-day GPT-5.5 release coverage: 0.19) and "topically similar
 *     but different events" (different OpenAI launches separated by
 *     months sit at 0.21+ — all "OpenAI launches a thing" but NOT the
 *     same event).
 *   MERGE_PAIRS_WITHIN_FRACTION = 0.5 — majority of cross-pairs must be
 *     within MIN distance, not just one outlier near-twin.
 *   MERGE_TIME_OVERLAP_HOURS = 72 — items must be published within 72h
 *     of each other to count as candidate cross-pairs (item-level, not
 *     cluster-level — clusters of backfilled items from different months
 *     must not pair just because both cluster ROWS happened to be created
 *     today).
 *
 * If the embedding model changes, all four constants must be re-validated
 * against a hand-labeled sample. See docs/aggregation/HANDOFF-2026-04-25.md
 * "Open follow-ups" for the validation procedure.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { items, clusters } from "@/db/schema";

export const MERGE_MIN_DISTANCE = 0.25;
export const MERGE_MEAN_DISTANCE = 0.2;
export const MERGE_PAIRS_WITHIN_FRACTION = 0.5;
export const MERGE_TIME_OVERLAP_HOURS = 72;

export type MergeReport = {
  candidatePairs: number;
  mergesExecuted: number;
  skipped: number;
  itemsMoved: number;
  durationMs: number;
  errors: Array<{ winnerId: number; loserId: number; reason: string }>;
};

export type MergeOpts = {
  /**
   * Recency window for considering clusters by `latest_member_at`. Null
   * means all-time (full backfill). Cron passes a tight window (e.g., 6h)
   * so each tick runs fast; the manual CLI defaults to 72h, with `--all`
   * for the no-bound mode.
   */
  recencyHours: number | null;
  /**
   * Optional progress callback fired once per merge (post-commit). Useful
   * for the CLI to print human-readable lines while cron runs silent.
   */
  onMerge?: (event: {
    winnerId: number;
    loserId: number;
    sizeWinner: number;
    sizeLoser: number;
    minDistance: number;
    meanDistance: number;
    pairsWithin: number;
    totalPairs: number;
  }) => void;
  /**
   * Dry-run flag. When true, identifies merges and fires `onMerge` but
   * does not write to the DB. Used by the CLI's default mode.
   */
  dryRun?: boolean;
};

/** Raw row shape returned by the candidate pair query. */
type CandidatePair = {
  cluster_a: number;
  cluster_b: number;
  size_a: number;
  size_b: number;
  min_distance: number;
  mean_distance: number;
  pairs_within: number;
  total_pairs: number;
};

export async function runMergeBatch(opts: MergeOpts): Promise<MergeReport> {
  const started = Date.now();
  const client = db();

  const recencyFilter =
    opts.recencyHours == null
      ? sql`TRUE`
      : sql`c.latest_member_at > now() - make_interval(hours => ${opts.recencyHours})`;

  // No-content cluster filter: clusters of items whose source had no body
  // (e.g., an X post that's just a t.co link, or an RSS entry whose body
  // failed to fetch). Stage C's canonical-title LLM falls back to phrases
  // like "未披露内容无法核实" / "X post with undisclosed link content".
  // These clusters' embeddings encode "I have no content" — pairs will be
  // similar, but the items aren't about the same event. Merging them spawns
  // a mega-cluster of unrelated noise. Skip outright.
  const noContentSkip = sql`(
    (c.canonical_title_zh ILIKE '%未披露%'
      OR c.canonical_title_zh ILIKE '%无法核实%'
      OR c.canonical_title_zh ILIKE '%无法验证%'
      OR c.canonical_title_zh ILIKE '%未提供%'
      OR c.canonical_title_zh ILIKE '%内容不明%'
      OR c.canonical_title_zh ILIKE '%链接占位%'
      OR c.canonical_title_zh ILIKE '%神秘链接%')
    OR
    (c.canonical_title_en ILIKE '%undisclosed%'
      OR c.canonical_title_en ILIKE '%unable to verify%'
      OR c.canonical_title_en ILIKE '%cannot be verified%'
      OR c.canonical_title_en ILIKE '%no verifiable%'
      OR c.canonical_title_en ILIKE '%without disclosed%'
      OR c.canonical_title_en ILIKE '%mysterious link%')
  )`;

  // Time-overlap is computed at the ITEM level on published_at — NOT at
  // cluster.first_seen_at, which is just when the cluster ROW was created.
  // A cluster might wrap items from months ago (e.g., backfilled blog posts);
  // we must not merge it with another cluster of items from a different
  // period just because both rows happen to have been created on the same
  // day.
  const candidates = (await client.execute(sql`
    WITH multi AS (
      SELECT c.id,
             c.member_count
      FROM clusters c
      WHERE c.member_count >= 2
        AND ${recencyFilter}
        AND NOT ${noContentSkip}
    ),
    pair_distances AS (
      SELECT
        a.id AS cluster_a,
        b.id AS cluster_b,
        a.member_count AS size_a,
        b.member_count AS size_b,
        MIN(ia.embedding <=> ib.embedding)::float8 AS min_distance,
        AVG(ia.embedding <=> ib.embedding)::float8 AS mean_distance,
        COUNT(*) FILTER (WHERE (ia.embedding <=> ib.embedding) <= ${MERGE_MIN_DISTANCE})::int AS pairs_within,
        COUNT(*)::int AS total_pairs
      FROM multi a
      JOIN multi b ON a.id < b.id
      JOIN items ia ON ia.cluster_id = a.id AND ia.embedding IS NOT NULL
      JOIN items ib ON ib.cluster_id = b.id AND ib.embedding IS NOT NULL
      WHERE ABS(EXTRACT(EPOCH FROM (ia.published_at - ib.published_at))) <= ${MERGE_TIME_OVERLAP_HOURS * 3600}
      GROUP BY a.id, b.id, a.member_count, b.member_count
    )
    SELECT *
    FROM pair_distances
    WHERE min_distance <= ${MERGE_MIN_DISTANCE}
      AND mean_distance <= ${MERGE_MEAN_DISTANCE}
      AND (pairs_within::float8 / total_pairs::float8) >= ${MERGE_PAIRS_WITHIN_FRACTION}
    ORDER BY mean_distance ASC, cluster_a ASC
  `)) as unknown as CandidatePair[];

  // Multiple candidate pairs may share a cluster (transitive merges):
  //   {A, B} and {B, C} should both merge → A absorbs B, then C.
  // Walk the pairs in mean-distance-ASC order; track which clusters have
  // been absorbed and reroute survivors using a union-find-style parent
  // map. Using mean-distance ordering means tighter pairs commit first,
  // so weaker pairs that share a cluster get the benefit of the prior
  // (more confident) merge as their context.
  const survivorOf = new Map<number, number>();
  function findSurvivor(id: number): number {
    let cur = id;
    while (survivorOf.has(cur)) {
      const next = survivorOf.get(cur)!;
      if (next === cur) break;
      cur = next;
    }
    return cur;
  }

  let mergesExecuted = 0;
  let skipped = 0;
  let itemsMoved = 0;
  const errors: MergeReport["errors"] = [];

  for (const pair of candidates) {
    const survivorId = findSurvivor(pair.cluster_a);
    const loserId = findSurvivor(pair.cluster_b);

    if (survivorId === loserId) {
      // Already merged transitively
      skipped++;
      continue;
    }

    // Older cluster wins (smaller id = created earlier).
    const [winner, lost] =
      survivorId < loserId ? [survivorId, loserId] : [loserId, survivorId];

    if (!opts.dryRun) {
      try {
        const moved = await mergeClusters(winner, lost);
        itemsMoved += moved;
      } catch (err) {
        errors.push({
          winnerId: winner,
          loserId: lost,
          reason: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
    }

    survivorOf.set(lost, winner);
    mergesExecuted++;

    opts.onMerge?.({
      winnerId: winner,
      loserId: lost,
      // sizes reported here are pre-merge — the loser's size goes from
      // size_b → 0 and the winner's size grows by size_b. Stale-but-correct
      // for the audit trail since transitive merges are sequenced.
      sizeWinner: winner === survivorId ? pair.size_a : pair.size_b,
      sizeLoser: winner === survivorId ? pair.size_b : pair.size_a,
      minDistance: pair.min_distance,
      meanDistance: pair.mean_distance,
      pairsWithin: pair.pairs_within,
      totalPairs: pair.total_pairs,
    });
  }

  return {
    candidatePairs: candidates.length,
    mergesExecuted,
    skipped,
    itemsMoved,
    durationMs: Date.now() - started,
    errors,
  };
}

/**
 * Atomically merge `loserId` into `winnerId`:
 *   - Move all loser items → winner cluster_id; null cluster_verified_at.
 *   - Bump winner.member_count + coverage by the count actually moved.
 *   - Reset winner.{verified_at, titled_at, commentary_at} so Stages B/C/D
 *     regenerate with the new pool.
 *   - Delete loser cluster row.
 *
 * Returns the number of items moved (0 if loser was already empty).
 */
export async function mergeClusters(
  winnerId: number,
  loserId: number,
): Promise<number> {
  const client = db();
  let movedCount = 0;

  await client.transaction(async (tx) => {
    const moved = await tx
      .update(items)
      .set({
        clusterId: winnerId,
        clusterVerifiedAt: null,
        clusteredAt: new Date(),
      })
      .where(sql`${items.clusterId} = ${loserId}`)
      .returning({ id: items.id });

    movedCount = moved.length;
    if (movedCount === 0) {
      // Loser was already empty (concurrent run). Just clean up the row.
      await tx.delete(clusters).where(sql`${clusters.id} = ${loserId}`);
      return;
    }

    await tx
      .update(clusters)
      .set({
        memberCount: sql`${clusters.memberCount} + ${movedCount}`,
        coverage: sql`${clusters.coverage} + ${movedCount}`,
        latestMemberAt: new Date(),
        verifiedAt: null,
        titledAt: null,
        commentaryAt: null,
        updatedAt: new Date(),
      })
      .where(sql`${clusters.id} = ${winnerId}`);

    await tx.delete(clusters).where(sql`${clusters.id} = ${loserId}`);
  });

  return movedCount;
}
