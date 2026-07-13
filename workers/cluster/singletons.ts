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
import { db, retryTransaction } from "@/db/client";
import { clusters, items } from "@/db/schema";
import { visibleTierInSql } from "@/lib/items/tier-sql";
import { MAX_DISTINCT_SPLIT_RETRIES_PER_ITEM } from "./split-audit";
import { notClusteringOptedOut } from "./clustering-eligibility";

export const SINGLETON_RECLUSTER_SIMILARITY_THRESHOLD = 0.75;
export const SINGLETON_RECLUSTER_WINDOW_HOURS = 72;
/**
 * Recheck cooldown (FIX-W7 / A2). A singleton kept as a singleton is not
 * neighbor-scanned again for this long. This is the dominant read-budget lever:
 * without it, the same persistent singletons were re-scanned every tick
 * (~144×/72h). Must stay well under SINGLETON_RECLUSTER_WINDOW_HOURS (72) so a
 * late-arriving duplicate is still caught within one cooldown period — the
 * waterline only delays a merge by ≤cooldown hours, it never misses one.
 */
export const SINGLETON_RECHECK_COOLDOWN_HOURS = 12;
const MAX_SINGLETON_RECLUSTERS_PER_RUN = 150;

/** Injected drizzle handle; defaults to the real `db()` in production. */
type Db = ReturnType<typeof db>;

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
   * Recheck cooldown in hours (FIX-W7 / A2). `undefined` → the default
   * SINGLETON_RECHECK_COOLDOWN_HOURS; `null` → no cooldown (manual backfills
   * that must re-scan everything regardless of recent rechecks).
   */
  cooldownHours?: number | null;
  /**
   * Dry-run flag. When true, reports moves and fires `onMove` without writes.
   */
  dryRun?: boolean;
  /** Injected DB handle for tests; defaults to the real `db()`. */
  client?: Db;
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
  /** SQLite boolean expression — 0/1. */
  verified: number;
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

/**
 * Recheck cooldown in ms. `null` means "no cooldown" (manual backfill);
 * `undefined` falls back to the default SINGLETON_RECHECK_COOLDOWN_HOURS.
 */
export function resolveSingletonCooldownMs(
  cooldownHours: number | null | undefined,
): number | null {
  if (cooldownHours === null) return null;
  return (cooldownHours ?? SINGLETON_RECHECK_COOLDOWN_HOURS) * 3_600_000;
}

/**
 * The A.5 candidate SELECT: recent, enriched, visible-tier singleton items
 * whose cluster is unverified and NOT clustering-opted-out, EXCLUDING those
 * neighbor-scanned within the cooldown (FIX-W7 / A2). Ordered recheck-stalest
 * first (never-checked NULLs sort first in SQLite ASC), so the cooldown rotates
 * the batch across all singletons instead of the old published-ASC ordering
 * that re-picked — and starved behind — the same oldest 150 every tick.
 */
export async function selectSingletonReclusterCandidates(
  opts: {
    recencyHours: number | null;
    maxPerRun?: number | null;
    cooldownHours?: number | null;
    now?: number;
  },
  client: Db = db(),
): Promise<SingletonRow[]> {
  const now = opts.now ?? Date.now();
  const maxPerRun = resolveSingletonReclusterLimit(opts.maxPerRun);
  const cooldownMs = resolveSingletonCooldownMs(opts.cooldownHours);

  const windowFilter =
    opts.recencyHours == null
      ? sql`TRUE`
      : sql`i.published_at > ${now - opts.recencyHours * 3_600_000}`;
  const cooldownFilter =
    cooldownMs == null
      ? sql`TRUE`
      : sql`(i.last_recheck_at IS NULL OR i.last_recheck_at <= ${now - cooldownMs})`;
  const limitClause = maxPerRun == null ? sql`` : sql`LIMIT ${maxPerRun}`;

  return client.all<SingletonRow>(sql`
    SELECT i.id AS item_id, i.cluster_id,
           SUBSTR(COALESCE(i.title_zh, i.title), 1, 120) AS title
    FROM items i
    JOIN clusters c ON i.cluster_id = c.id
    WHERE c.member_count = 1
      AND i.cluster_verified_at IS NULL
      AND ${windowFilter}
      AND ${cooldownFilter}
      AND i.embedding IS NOT NULL
      AND i.enriched_at IS NOT NULL
      AND ${visibleTierInSql(sql`i.tier`)}
      AND ${notClusteringOptedOut("i")}
    ORDER BY i.last_recheck_at ASC, i.published_at ASC
    ${limitClause}
  `);
}

export async function runSingletonReclusterBatch(
  opts: SingletonReclusterOpts,
): Promise<SingletonReclusterReport> {
  const started = Date.now();
  const now = started;
  const client = opts.client ?? db();

  const singletons = await selectSingletonReclusterCandidates(
    {
      recencyHours: opts.recencyHours,
      maxPerRun: opts.maxPerRun,
      cooldownHours: opts.cooldownHours,
      now,
    },
    client,
  );

  let merged = 0;
  let kept = 0;
  // Singletons that were neighbor-scanned and stayed singletons this run.
  // Stamped with `last_recheck_at = now` at the end so the waterline skips them
  // next tick (FIX-W7 / A2). Only genuine keep-decisions land here — items that
  // grew/verified (live guard) or failed a move guard are left unstamped.
  const recheckedIds: number[] = [];
  const errors: SingletonReclusterReport["errors"] = [];

  for (const s of singletons) {
    try {
      const liveRows = await client.all<LiveRow>(sql`
        SELECT c.member_count, i.cluster_verified_at IS NOT NULL AS verified
        FROM items i
        JOIN clusters c ON i.cluster_id = c.id
        WHERE i.id = ${s.item_id}
      `);
      const live = liveRows[0];
      if (!live || live.member_count > 1 || live.verified) {
        kept++;
        continue;
      }

      const reclusterWindowMs =
        SINGLETON_RECLUSTER_WINDOW_HOURS * 3_600_000;
      const neighbors = await client.all<NeighborRow>(sql`
        WITH target AS (
          SELECT
            embedding,
            published_at,
            (
              SELECT count(DISTINCT split_audit.from_cluster_id)
              FROM cluster_splits split_audit
              WHERE split_audit.item_id = ${s.item_id}
            ) AS rejected_cluster_count
          FROM items WHERE id = ${s.item_id}
        )
        SELECT i.id, i.cluster_id,
               vector_distance_cos(i.embedding, (SELECT embedding FROM target)) AS distance
        FROM items i
        WHERE i.id <> ${s.item_id}
          AND i.cluster_id IS NOT NULL
          AND i.embedding IS NOT NULL
          AND i.enriched_at IS NOT NULL
          AND ${visibleTierInSql(sql`i.tier`)}
          AND ${notClusteringOptedOut("i")}
          AND (SELECT rejected_cluster_count FROM target) < ${MAX_DISTINCT_SPLIT_RETRIES_PER_ITEM}
          AND NOT EXISTS (
            SELECT 1
            FROM cluster_splits split_audit
            WHERE split_audit.item_id = ${s.item_id}
              AND split_audit.from_cluster_id = i.cluster_id
          )
          AND i.published_at BETWEEN
              (SELECT published_at FROM target) - ${reclusterWindowMs}
              AND
              (SELECT published_at FROM target) + ${reclusterWindowMs}
        ORDER BY vector_distance_cos(i.embedding, (SELECT embedding FROM target))
        LIMIT 1
      `);

      const nearest = neighbors[0];
      const decision = decideSingletonRecluster({
        currentClusterId: s.cluster_id,
        nearest: nearest
          ? { clusterId: nearest.cluster_id, distance: nearest.distance }
          : null,
      });

      if (decision.action === "keep") {
        kept++;
        recheckedIds.push(s.item_id);
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
        const moved = await moveSingletonToCluster(
          {
            itemId: s.item_id,
            fromClusterId: s.cluster_id,
            targetClusterId: decision.targetClusterId,
          },
          client,
        );
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

  // Stamp the recheck waterline for kept singletons in one set-based write so
  // they are skipped for the cooldown window (FIX-W7 / A2). Skipped on dry-run.
  if (!opts.dryRun && recheckedIds.length > 0) {
    await client.run(sql`
      UPDATE items SET last_recheck_at = ${now}
      WHERE id IN (${sql.join(
        recheckedIds.map((id) => sql`${id}`),
        sql`, `,
      )})
    `);
  }

  return {
    processed: singletons.length,
    merged,
    kept,
    durationMs: Date.now() - started,
    errors,
  };
}

async function moveSingletonToCluster(
  input: {
    itemId: number;
    fromClusterId: number;
    targetClusterId: number;
  },
  client: Db = db(),
): Promise<number> {
  let movedCount = 0;

  // `behavior: "immediate"` takes the write lock up front so the
  // member_count guard read happens under it (replaces Postgres's
  // row-level SELECT ... FOR UPDATE — SQLite locks are database-wide).
  await retryTransaction(
    client,
    async (tx) => {
      const sourceRows = await tx.all<{ id: number }>(sql`
      SELECT id
      FROM clusters
      WHERE id = ${input.fromClusterId}
        AND member_count = 1
    `);

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
    },
    { behavior: "immediate" },
  );

  return movedCount;
}
