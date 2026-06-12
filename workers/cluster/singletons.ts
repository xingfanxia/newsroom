/**
 * Stage A.5 singleton recluster — repair items that already became singleton
 * clusters before another same-event cluster was available.
 *
 * Stage A only processes items where `clustered_at IS NULL`. Once an item has
 * been assigned to a singleton cluster, it is out of Stage A forever. That is
 * fine for truly solo coverage, but it leaks duplicate event cards when a
 * matching item/cluster appears later. This stage rechecks recent singleton
 * clusters against the same nearest-neighbor rule Stage A uses and migrates
 * them into the nearest different cluster when similarity passes the threshold.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clusters, items } from "@/db/schema";

export const SINGLETON_RECLUSTER_SIMILARITY_THRESHOLD = 0.75;
export const SINGLETON_RECLUSTER_WINDOW_HOURS = 72;
const MAX_SINGLETON_RECLUSTERS_PER_RUN = 150;

export type SingletonReclusterReport = {
  processed: number;
  merged: number;
  kept: number;
  durationMs: number;
  errors: Array<{ itemId: number; reason: string }>;
};

export type SingletonReclusterOpts = {
  /**
   * Recency window for candidate singleton items by `published_at`.
   * Null means all-time and is intended for manual backfills.
   */
  recencyHours: number | null;
  /**
   * Maximum singleton rows to inspect this run. Null means no cap and is
   * intended for manual backfills, not cron.
   */
  maxPerRun?: number | null;
  /**
   * Dry-run flag. When true, reports moves and fires `onMove` without writes.
   */
  dryRun?: boolean;
  onMove?: (event: {
    itemId: number;
    fromClusterId: number;
    targetClusterId: number;
    similarity: number;
    title: string;
  }) => void;
};

type SingletonRow = {
  item_id: number;
  cluster_id: number;
  title: string;
};

type LiveRow = {
  member_count: number;
  verified: boolean;
};

type NeighborRow = {
  id: number;
  cluster_id: number | null;
  distance: number;
};

export type SingletonReclusterDecision =
  | { action: "move"; targetClusterId: number }
  | {
      action: "keep";
      reason:
        | "no-neighbor"
        | "unclustered-neighbor"
        | "same-cluster"
        | "below-threshold";
    };

export function decideSingletonRecluster(input: {
  currentClusterId: number;
  nearest: { clusterId: number | null; distance: number } | null | undefined;
}): SingletonReclusterDecision {
  const nearest = input.nearest;
  if (!nearest) return { action: "keep", reason: "no-neighbor" };
  if (nearest.clusterId == null) {
    return { action: "keep", reason: "unclustered-neighbor" };
  }
  if (nearest.clusterId === input.currentClusterId) {
    return { action: "keep", reason: "same-cluster" };
  }

  const distanceThreshold = 1 - SINGLETON_RECLUSTER_SIMILARITY_THRESHOLD;
  if (nearest.distance > distanceThreshold) {
    return { action: "keep", reason: "below-threshold" };
  }

  return { action: "move", targetClusterId: nearest.clusterId };
}

export function resolveSingletonReclusterLimit(
  maxPerRun: number | null | undefined,
): number | null {
  return maxPerRun === undefined
    ? MAX_SINGLETON_RECLUSTERS_PER_RUN
    : maxPerRun;
}

export async function runSingletonReclusterBatch(
  opts: SingletonReclusterOpts,
): Promise<SingletonReclusterReport> {
  const started = Date.now();
  const client = db();
  const maxPerRun = resolveSingletonReclusterLimit(opts.maxPerRun);

  const windowFilter =
    opts.recencyHours == null
      ? sql`TRUE`
      : sql`i.published_at > now() - make_interval(hours => ${opts.recencyHours})`;
  const limitClause = maxPerRun == null ? sql`` : sql`LIMIT ${maxPerRun}`;

  const singletons = (await client.execute(sql`
    SELECT i.id AS item_id, i.cluster_id,
           LEFT(COALESCE(i.title_zh, i.title), 120) AS title
    FROM items i
    JOIN clusters c ON i.cluster_id = c.id
    WHERE c.member_count = 1
      AND i.cluster_verified_at IS NULL
      AND ${windowFilter}
      AND i.embedding IS NOT NULL
      AND i.enriched_at IS NOT NULL
    ORDER BY i.published_at ASC
    ${limitClause}
  `)) as unknown as SingletonRow[];

  let merged = 0;
  let kept = 0;
  const errors: SingletonReclusterReport["errors"] = [];

  for (const s of singletons) {
    try {
      const liveRows = (await client.execute(sql`
        SELECT c.member_count, i.cluster_verified_at IS NOT NULL AS verified
        FROM items i
        JOIN clusters c ON i.cluster_id = c.id
        WHERE i.id = ${s.item_id}
      `)) as unknown as LiveRow[];
      const live = liveRows[0];
      if (!live || live.member_count > 1 || live.verified) {
        kept++;
        continue;
      }

      const neighbors = (await client.execute(sql`
        WITH target AS (
          SELECT embedding, published_at FROM items WHERE id = ${s.item_id}
        )
        SELECT i.id, i.cluster_id,
               (i.embedding <=> (SELECT embedding FROM target))::float8 AS distance
        FROM items i
        WHERE i.id <> ${s.item_id}
          AND i.cluster_id IS NOT NULL
          AND i.embedding IS NOT NULL
          AND i.enriched_at IS NOT NULL
          AND i.published_at BETWEEN
              (SELECT published_at FROM target) - make_interval(hours => ${SINGLETON_RECLUSTER_WINDOW_HOURS})
              AND
              (SELECT published_at FROM target) + make_interval(hours => ${SINGLETON_RECLUSTER_WINDOW_HOURS})
        ORDER BY i.embedding <=> (SELECT embedding FROM target)
        LIMIT 1
      `)) as unknown as NeighborRow[];

      const nearest = neighbors[0];
      const decision = decideSingletonRecluster({
        currentClusterId: s.cluster_id,
        nearest: nearest
          ? { clusterId: nearest.cluster_id, distance: nearest.distance }
          : null,
      });

      if (decision.action === "keep") {
        kept++;
        continue;
      }

      opts.onMove?.({
        itemId: s.item_id,
        fromClusterId: s.cluster_id,
        targetClusterId: decision.targetClusterId,
        similarity: nearest ? 1 - nearest.distance : 0,
        title: s.title,
      });

      if (!opts.dryRun) {
        const moved = await moveSingletonToCluster({
          itemId: s.item_id,
          fromClusterId: s.cluster_id,
          targetClusterId: decision.targetClusterId,
        });
        if (moved === 0) {
          kept++;
          continue;
        }
      }

      merged++;
    } catch (err) {
      errors.push({
        itemId: s.item_id,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    processed: singletons.length,
    merged,
    kept,
    durationMs: Date.now() - started,
    errors,
  };
}

async function moveSingletonToCluster(input: {
  itemId: number;
  fromClusterId: number;
  targetClusterId: number;
}): Promise<number> {
  const client = db();
  let movedCount = 0;

  await client.transaction(async (tx) => {
    const sourceRows = (await tx.execute(sql`
      SELECT id
      FROM clusters
      WHERE id = ${input.fromClusterId}
        AND member_count = 1
      FOR UPDATE
    `)) as unknown as Array<{ id: number }>;

    if (sourceRows.length === 0) return;

    const moved = await tx
      .update(items)
      .set({
        clusterId: input.targetClusterId,
        clusteredAt: new Date(),
        clusterVerifiedAt: null,
      })
      .where(
        sql`${items.id} = ${input.itemId}
          AND ${items.clusterId} = ${input.fromClusterId}`,
      )
      .returning({ id: items.id });

    movedCount = moved.length;
    if (movedCount === 0) return;

    await tx
      .update(clusters)
      .set({
        memberCount: sql`${clusters.memberCount} + ${movedCount}`,
        coverage: sql`${clusters.memberCount} + ${movedCount}`,
        latestMemberAt: new Date(),
        verifiedAt: null,
        titledAt: null,
        commentaryAt: null,
        updatedAt: new Date(),
      })
      .where(sql`${clusters.id} = ${input.targetClusterId}`);

    await tx
      .delete(clusters)
      .where(
        sql`${clusters.id} = ${input.fromClusterId}
          AND ${clusters.memberCount} = 1`,
      );
  });

  return movedCount;
}
