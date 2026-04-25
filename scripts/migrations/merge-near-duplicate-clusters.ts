/**
 * Merge near-duplicate multi-member clusters into one.
 *
 * Stage A is greedy and append-only — once two clusters about the same event
 * have formed (e.g., {Bloomberg-A, Bloomberg-B} and {HN-A, HN-B} both about a
 * Google→Anthropic $40B announcement), the pipeline has no path to merge them
 * even though every cross-cluster pair sits at sim ≥ 0.87. The Stage A
 * `prefer-clustered` patch prevents NEW clones; this script repairs the
 * existing data.
 *
 * Logic (per pair of multi-member clusters in time-overlapping windows):
 *   1. Compute the MIN cosine distance between any cross-cluster member pair.
 *   2. If MIN ≤ MERGE_THRESHOLD, also compute MEAN cross-cluster distance.
 *   3. If MEAN ≤ MEAN_THRESHOLD, merge:
 *        survivor = older cluster (smaller id)
 *        loser    = newer cluster
 *        - Move all loser members → survivor
 *        - Bump survivor.member_count + coverage by loser.member_count
 *        - Reset survivor.verified_at / titled_at / commentary_at so Stages
 *          B/C/D regenerate with the larger pool
 *        - Null all moved items' cluster_verified_at so Stage B re-arbitrates
 *        - Delete loser cluster row
 *
 * Idempotent: re-running on the same window does nothing once merges complete
 * (the loser cluster ids are gone; the survivors are already merged).
 *
 * Usage:
 *   bun run scripts/migrations/merge-near-duplicate-clusters.ts                    # dry-run, last 72h
 *   bun run scripts/migrations/merge-near-duplicate-clusters.ts --apply            # commit
 *   bun run scripts/migrations/merge-near-duplicate-clusters.ts --hours 168 --apply
 *   bun run scripts/migrations/merge-near-duplicate-clusters.ts --all              # all multi-member clusters
 */

import { sql } from "drizzle-orm";
import { db, closeDb } from "@/db/client";
import { items, clusters } from "@/db/schema";

// MIN cross-cluster pair must be within Stage A's same-event threshold —
// matching what the runtime would have done if the clusters had formed in
// a different order.
const MERGE_MIN_DISTANCE = 0.25; // sim ≥ 0.75
// MEAN safety check — tighter than MIN to filter out "topically similar but
// different events". Empirically: same-event pairs sit at mean ≤ 0.15 (the
// Anthropic-Google reference case is 0.091; QbitAI editor-hiring repeats sit
// at 0.05-0.10; same-day GPT-5.5 release coverage hits 0.19). Different
// OpenAI launches separated by months sit at 0.21+ (GPT-5 vs GPT-5-Codex vs
// GPT-5.2 vs Codex 2.0 etc — all "OpenAI launches a thing" topical-similar
// but NOT the same event). 0.20 is the cliff that separates them.
const MERGE_MEAN_DISTANCE = 0.2;
// Majority-coherence check: fraction of cross-cluster (a, b) pairs that must
// be within MERGE_MIN_DISTANCE for the merge to fire. Without this, a single
// shared near-twin in two otherwise-different clusters can drag the MEAN
// below threshold (one tight pair + lots of mid-distance pairs) and trigger
// a false merge. At 0.5, at least half of cross-pairs must look like the
// same event. The Anthropic-Google reference case is 4/4=100%; typical
// 5+ member transitive merges sit at 60-100%.
const MERGE_PAIRS_WITHIN_FRACTION = 0.5;
const TIME_OVERLAP_HOURS = 72;

type CliFlags = { apply: boolean; hours: number | null };

function parseFlags(): CliFlags {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const all = args.includes("--all");
  if (all) return { apply, hours: null };
  const hoursIdx = args.indexOf("--hours");
  const hours =
    hoursIdx >= 0 && args[hoursIdx + 1]
      ? Number.parseInt(args[hoursIdx + 1], 10)
      : 72;
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new Error(`invalid --hours value: ${args[hoursIdx + 1]}`);
  }
  return { apply, hours };
}

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

async function main() {
  const { apply, hours } = parseFlags();
  const client = db();

  console.log(
    `[merge-clusters] mode=${apply ? "APPLY" : "DRY-RUN"} window=${hours == null ? "ALL" : `${hours}h`} threshold=min≤${MERGE_MIN_DISTANCE} mean≤${MERGE_MEAN_DISTANCE} pairs_within≥${(MERGE_PAIRS_WITHIN_FRACTION * 100).toFixed(0)}%`,
  );

  // Find candidate cluster pairs:
  // - Both multi-member.
  // - Time windows overlap by ≤ TIME_OVERLAP_HOURS (using earliest/latest member).
  // - For each pair, compute MIN and MEAN cross-cluster cosine distance.
  // - Filter by distance thresholds.
  // - Only consider clusters whose latest_member_at is within the recency window.
  //
  // We do this with a single CTE-heavy query so the heavy lifting (pairwise
  // distance compute) happens in Postgres, not in TS.
  const recencyFilter = hours == null
    ? sql`TRUE`
    : sql`c.latest_member_at > now() - make_interval(hours => ${hours})`;

  // No-content cluster filter: clusters of items whose source had no body
  // (e.g., an X post that's just a t.co link, or an RSS entry whose body
  // failed to fetch). Stage C's canonical-title LLM falls back to phrases
  // like "未披露内容无法核实" / "X post with undisclosed link content".
  // These clusters' embeddings encode "I have no content" — pairs will be
  // similar, but the items aren't about the same event. Merging them spawns
  // a mega-cluster of unrelated noise. Skip outright.
  //
  // Pattern matching is OR-anchored on either language; clusters with NULL
  // titles (Stage C hasn't run) are allowed through.
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

  // Time-overlap is computed at the ITEM level on published_at — NOT at the
  // cluster's first_seen_at, which is just when the cluster ROW was created.
  // A cluster might wrap items published months ago (e.g., backfilled OpenAI
  // blog posts about GPT-5.2-Codex from December 2025), and we must NOT merge
  // it with another cluster wrapping items from a different month, even if
  // both cluster rows happen to have been created on the same day.
  //
  // pair_items: only consider cross-cluster (a, b) item pairs whose published_at
  // values are within TIME_OVERLAP_HOURS of each other. Distance stats are
  // computed over THIS filtered set, so unrelated-but-topically-similar items
  // from different time periods don't contribute to the mean.
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
      WHERE ABS(EXTRACT(EPOCH FROM (ia.published_at - ib.published_at))) <= ${TIME_OVERLAP_HOURS * 3600}
      GROUP BY a.id, b.id, a.member_count, b.member_count
    )
    SELECT *
    FROM pair_distances
    WHERE min_distance <= ${MERGE_MIN_DISTANCE}
      AND mean_distance <= ${MERGE_MEAN_DISTANCE}
      AND (pairs_within::float8 / total_pairs::float8) >= ${MERGE_PAIRS_WITHIN_FRACTION}
    ORDER BY mean_distance ASC, cluster_a ASC
  `)) as unknown as CandidatePair[];

  console.log(
    `[merge-clusters] candidate pairs: ${candidates.length}\n`,
  );

  // Multiple candidate pairs may share a cluster (transitive merges):
  //   {A, B} and {B, C} should both merge → survivor=A absorbs B, then C.
  // Walk the pairs in order; track which clusters have been absorbed
  // ("ghosts") and reroute survivors using a union-find-style parent map.
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

  let merged = 0;
  let skipped = 0;
  let errors = 0;

  for (const pair of candidates) {
    const survivorId = findSurvivor(pair.cluster_a);
    const loserId = findSurvivor(pair.cluster_b);

    if (survivorId === loserId) {
      // Already merged (transitive)
      skipped++;
      continue;
    }

    // Pick the OLDER cluster as survivor (smaller id = created earlier).
    // The mapped survivors might have flipped order vs the original pair,
    // so re-derive after find().
    const [winner, lost] =
      survivorId < loserId ? [survivorId, loserId] : [loserId, survivorId];

    const sim = (1 - pair.mean_distance).toFixed(3);
    console.log(
      `  merge cluster ${lost} (${pair.size_b} members) → cluster ${winner} (${pair.size_a} members)`,
    );
    console.log(
      `    min=${pair.min_distance.toFixed(3)} mean=${pair.mean_distance.toFixed(3)} (sim ≈ ${sim}) pairs_within=${pair.pairs_within}/${pair.total_pairs}`,
    );

    if (apply) {
      try {
        await mergeClusters(winner, lost);
      } catch (err) {
        errors++;
        console.error(
          `    ! merge failed:`,
          err instanceof Error ? err.message : err,
        );
        continue;
      }
    }

    survivorOf.set(lost, winner);
    merged++;
  }

  console.log("\n[merge-clusters] summary");
  console.log(`  pairs evaluated:    ${candidates.length}`);
  console.log(`  merges executed:    ${merged}`);
  console.log(`  skipped (transitive already-merged): ${skipped}`);
  console.log(`  errors:             ${errors}`);
  if (!apply && merged > 0) {
    console.log(`\n  re-run with --apply to commit.`);
  }
  await closeDb();
}

/**
 * Atomically merge `loserId` into `winnerId`:
 *   - Move all loser items → winner cluster_id; null cluster_verified_at.
 *   - Bump winner.member_count + coverage by the count actually moved.
 *   - Reset winner.{verified_at, titled_at, commentary_at} so Stages B/C/D
 *     regenerate with the new pool.
 *   - Delete loser cluster row.
 */
async function mergeClusters(winnerId: number, loserId: number): Promise<void> {
  const client = db();
  await client.transaction(async (tx) => {
    // Move members. Returning the count gives us an accurate delta even if
    // some rows were already orphaned.
    const moved = await tx
      .update(items)
      .set({
        clusterId: winnerId,
        clusterVerifiedAt: null,
        clusteredAt: new Date(),
      })
      .where(sql`${items.clusterId} = ${loserId}`)
      .returning({ id: items.id });

    const movedCount = moved.length;
    if (movedCount === 0) {
      // Loser was already empty (concurrent run). Just delete the cluster row.
      await tx
        .delete(clusters)
        .where(sql`${clusters.id} = ${loserId}`);
      return;
    }

    // Bump survivor counts + invalidate downstream-stage stamps so the merged
    // cluster gets re-arbitrated, re-titled, and re-commented with the larger
    // member pool.
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
}

await main();
