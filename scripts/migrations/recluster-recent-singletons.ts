/**
 * Re-cluster singleton items that should have joined a multi-member cluster
 * but didn't because of the verified-lock recall bug fixed in workers/cluster/index.ts.
 *
 * What this does (per item, in published_at-ASC order):
 *   1. Find the item's nearest neighbor in ±72h, NO verified filter.
 *   2. If sim ≥ SIMILARITY_THRESHOLD (0.75) AND neighbor is in a different,
 *      non-empty cluster → migrate the item there.
 *   3. Delete the now-orphaned singleton cluster row.
 *
 * Idempotent: re-running on the same window does nothing (items now have a
 * multi-member cluster_id and won't appear in the singleton list).
 *
 * Usage:
 *   bun run scripts/migrations/recluster-recent-singletons.ts             # dry-run, last 48h
 *   bun run scripts/migrations/recluster-recent-singletons.ts --apply     # actually mutate
 *   bun run scripts/migrations/recluster-recent-singletons.ts --hours 72  # widen window
 */

import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { items, clusters } from "@/db/schema";

const SIMILARITY_THRESHOLD = 0.75;
const WINDOW_HOURS = 72;

type CliFlags = { apply: boolean; hours: number };

function parseFlags(): CliFlags {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const hoursIdx = args.indexOf("--hours");
  const hours =
    hoursIdx >= 0 && args[hoursIdx + 1]
      ? Number.parseInt(args[hoursIdx + 1], 10)
      : 48;
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new Error(`invalid --hours value: ${args[hoursIdx + 1]}`);
  }
  return { apply, hours };
}

type SingletonRow = {
  item_id: number;
  cluster_id: number;
  published_at: Date;
  title: string;
};

type NeighborRow = {
  id: number;
  cluster_id: number | null;
  member_count: number | null;
  distance: number;
};

async function main() {
  const { apply, hours } = parseFlags();
  const client = db();
  const distanceThreshold = 1 - SIMILARITY_THRESHOLD;

  console.log(
    `[recluster-singletons] mode=${apply ? "APPLY" : "DRY-RUN"} window=${hours}h threshold=sim≥${SIMILARITY_THRESHOLD}`,
  );

  // Singletons we'll consider — published in window, member_count=1, not item-verified.
  // Sort by published_at ASC so earlier items merge into clusters first; later
  // items in the same group then find a now-larger target.
  const singletons = (await client.execute(sql`
    SELECT i.id AS item_id, i.cluster_id, i.published_at,
           LEFT(COALESCE(i.title_zh, i.title), 80) AS title
    FROM items i
    JOIN clusters c ON i.cluster_id = c.id
    WHERE c.member_count = 1
      AND i.cluster_verified_at IS NULL
      AND i.published_at > now() - make_interval(hours => ${hours})
      AND i.embedding IS NOT NULL
      AND i.enriched_at IS NOT NULL
    ORDER BY i.published_at ASC
  `)) as unknown as SingletonRow[];

  console.log(`[recluster-singletons] candidate singletons: ${singletons.length}`);

  let merged = 0;
  let kept = 0;
  let errors = 0;
  const mergesByTarget = new Map<number, number>();

  for (const s of singletons) {
    try {
      // Re-check that this item is still a singleton — symmetric-merge pairs
      // (each item is the other's nearest) can promote a singleton to
      // multi-member during this loop. If it's no longer a singleton, skip
      // (don't move an item OUT of a now-correct multi-member cluster).
      const liveCheck = (await client.execute(sql`
        SELECT c.member_count, i.cluster_verified_at IS NOT NULL AS verified
        FROM items i JOIN clusters c ON i.cluster_id = c.id
        WHERE i.id = ${s.item_id}
      `)) as unknown as Array<{ member_count: number; verified: boolean }>;
      const live = liveCheck[0];
      if (!live || live.member_count > 1 || live.verified) {
        kept++;
        continue;
      }

      const neighbors = (await client.execute(sql`
        WITH target AS (SELECT embedding, published_at FROM items WHERE id = ${s.item_id})
        SELECT i.id, i.cluster_id, c.member_count,
               (i.embedding <=> (SELECT embedding FROM target))::float8 AS distance
        FROM items i
        LEFT JOIN clusters c ON i.cluster_id = c.id
        WHERE i.id <> ${s.item_id}
          AND i.cluster_id IS NOT NULL
          AND i.cluster_id <> ${s.cluster_id}
          AND i.embedding IS NOT NULL
          AND i.enriched_at IS NOT NULL
          AND i.published_at BETWEEN
              (SELECT published_at FROM target) - make_interval(hours => ${WINDOW_HOURS})
              AND
              (SELECT published_at FROM target) + make_interval(hours => ${WINDOW_HOURS})
        ORDER BY i.embedding <=> (SELECT embedding FROM target)
        LIMIT 1
      `)) as unknown as NeighborRow[];

      const nearest = neighbors[0];
      if (!nearest || nearest.distance > distanceThreshold || nearest.cluster_id == null) {
        kept++;
        continue;
      }

      const targetClusterId = nearest.cluster_id;
      const sim = (1 - nearest.distance).toFixed(3);
      console.log(
        `  item ${s.item_id} (cluster ${s.cluster_id} singleton) → cluster ${targetClusterId} (sim=${sim}) — "${s.title}"`,
      );

      if (apply) {
        // Move item to target cluster, delete the abandoned singleton, bump
        // counts on target. Sequential operations are fine — script is single-threaded.
        await client
          .update(items)
          .set({ clusterId: targetClusterId, clusteredAt: new Date() })
          .where(sql`${items.id} = ${s.item_id}`);

        await client
          .update(clusters)
          .set({
            memberCount: sql`${clusters.memberCount} + 1`,
            coverage: sql`${clusters.memberCount} + 1`,
            latestMemberAt: new Date(),
            // Null commentary_at so Stage D regenerates with cross-source context
            // for clusters that just crossed the multi-member boundary.
            commentaryAt: null,
            // Null titled_at to prompt Stage C regen with the broader pool.
            titledAt: null,
            // Reset verified_at so Stage B re-arbitrates with the new member.
            verifiedAt: null,
            updatedAt: new Date(),
          })
          .where(sql`${clusters.id} = ${targetClusterId}`);

        // Drop item-level verified-lock so Stage B can include this item in
        // the next arbitration pass.
        await client
          .update(items)
          .set({ clusterVerifiedAt: null })
          .where(sql`${items.id} = ${s.item_id}`);

        // Delete the now-orphaned singleton cluster (member_count was 1).
        await client
          .delete(clusters)
          .where(sql`${clusters.id} = ${s.cluster_id}`);
      }

      merged++;
      mergesByTarget.set(targetClusterId, (mergesByTarget.get(targetClusterId) ?? 0) + 1);
    } catch (err) {
      errors++;
      console.error(`  ! item ${s.item_id} failed:`, err instanceof Error ? err.message : err);
    }
  }

  console.log("\n[recluster-singletons] summary");
  console.log(`  merged: ${merged}`);
  console.log(`  kept (no neighbor above threshold): ${kept}`);
  console.log(`  errors: ${errors}`);
  if (mergesByTarget.size > 0) {
    const top = [...mergesByTarget.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    console.log(`  top targets:`);
    for (const [cid, n] of top) console.log(`    cluster ${cid}: +${n} members`);
  }
  if (!apply && merged > 0) {
    console.log(`\n  re-run with --apply to commit.`);
  }
  process.exit(0);
}

await main();
