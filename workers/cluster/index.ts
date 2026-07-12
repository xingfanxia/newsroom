import { sql, and, inArray, isNull, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import { items, clusters } from "@/db/schema";
import { visibleTierInSql } from "@/lib/items/tier-sql";
import { VISIBLE_ITEM_TIERS } from "@/lib/types";
import { hasReachedSplitRejectionCap } from "./split-audit";

const MAX_PER_RUN = 200;
// Cosine similarity floor for join. 0.75 catches cross-source coverage of the
// same event ("DeepSeek announces V4" from TechCrunch vs Bloomberg vs Verge
// land at sim 0.76-0.77) while keeping genuinely-different angles separate
// ("DeepSeek announce" vs "DeepSeek 384K output spec" sit at sim 0.51).
// Stage B then arbitrates ambiguous merges and locks decisions.
const SIMILARITY_THRESHOLD = 0.75;
const WINDOW_HOURS = 72;

export type ClusterReport = {
  processed: number;
  assigned: number;
  newClusters: number;
  durationMs: number;
  errors?: { itemId: number; reason: string }[];
};

/**
 * Assign unclustered enriched items to clusters.
 * - If nearest neighbor (cosine sim ≥ threshold, within N-hour window) exists: join.
 * - Else: create a new single-member cluster with this item as lead.
 *
 * Uses libSQL's `vector_distance_cos()` (cosine distance = 1 - cosine sim)
 * for the nearest-neighbor lookup. The ±WINDOW_HOURS published_at window
 * bounds the scan to a few hundred candidate rows, so this runs as an
 * index-assisted brute-force pass — no DiskANN probe needed here.
 */
export async function runClusterBatch(): Promise<ClusterReport> {
  const started = Date.now();
  const client = db();

  const pending = await client
    .select({ id: items.id, title: items.title })
    .from(items)
    .where(
      and(
        isNull(items.clusteredAt),
        isNotNull(items.embedding),
        isNotNull(items.enrichedAt),
        inArray(items.tier, VISIBLE_ITEM_TIERS),
      ),
    )
    .limit(MAX_PER_RUN);

  if (pending.length === 0) {
    return {
      processed: 0,
      assigned: 0,
      newClusters: 0,
      durationMs: Date.now() - started,
    };
  }

  let assigned = 0;
  let newClusters = 0;

  const errors: { itemId: number; reason: string }[] = [];

  for (const p of pending) {
    try {
      const outcome = await assignOneToCluster(p.id);
      if (outcome === "assigned") assigned++;
      else if (outcome === "created") newClusters++;
      // "already-claimed" outcomes are silent — a concurrent run got there first.
    } catch (err) {
      errors.push({
        itemId: p.id,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    processed: pending.length,
    assigned,
    newClusters,
    durationMs: Date.now() - started,
    errors,
  };
}

type AssignOutcome = "assigned" | "created" | "already-claimed";
type ClusterClient = ReturnType<typeof db>;

async function assignOneToCluster(itemId: number): Promise<AssignOutcome> {
  const client = db();
  const threshold = 1 - SIMILARITY_THRESHOLD; // cosine sim → distance
  const rejectedClusterCount = await countDistinctRejectedClusters(client, itemId);
  if (hasReachedSplitRejectionCap(rejectedClusterCount)) {
    // The embedding neighborhood has repeatedly proven topical rather than
    // event-equivalent. End the loop here instead of spending more HNSW probes
    // and future arbitration calls on the same item.
    return createSingletonCluster(client, itemId);
  }

  // Two-pass nearest-neighbor lookup, split by cluster status. We bias Stage A
  // toward joining an existing cluster when both a clustered and an unclustered
  // neighbor sit within threshold — even if the unclustered one is slightly
  // closer.
  //
  // Why the bias: Stage A is greedy and append-only — it never merges clusters.
  // Without this bias, two near-duplicate items arriving in the same batch
  // (e.g., two Bloomberg articles about the same launch, both unclustered,
  // mutual nearest neighbors at sim 0.95) pair with EACH OTHER instead of
  // joining an older cluster about the same event that already has cross-
  // source coverage. The result was a parallel cluster that never reconciled —
  // visible to the user as the same story appearing as 2-3 separate event
  // cards (the Google→Anthropic $40B case: 6 items split across 3 clusters
  // by source, every pairwise distance < 0.13 well within threshold).
  //
  // Window is anchored to the target item's own published_at (bidirectional
  // ±WINDOW_HOURS) so backfill items can find their temporal cohort even when
  // they arrive late. Verified items are NOT excluded — Stage A only ADDS
  // members, never reshuffles, so a new item joining a Stage-B-verified
  // cluster is safe (the verified-lock protects existing membership, not
  // future joins).
  //
  // Stage B split verdicts are different: if the arbitrator already rejected
  // this item from a cluster, Stage A must not rejoin it to that same cluster
  // on every cron tick. The cluster_splits audit table is the negative edge.
  // After several distinct rejected clusters, keep the item as a singleton;
  // its embedding neighborhood is topical rather than event-equivalent.
  const windowMs = WINDOW_HOURS * 3_600_000;
  const nearestClusteredResult = await client.all<{
    id: number;
    cluster_id: number;
    distance: number;
  }>(sql`
    WITH target AS (
      SELECT
        embedding,
        published_at
      FROM items WHERE id = ${itemId}
    )
    SELECT
      i.id,
      i.cluster_id,
      vector_distance_cos(i.embedding, (SELECT embedding FROM target)) AS distance
    FROM items i
    WHERE i.id <> ${itemId}
      AND i.embedding IS NOT NULL
      AND i.enriched_at IS NOT NULL
      AND ${visibleTierInSql(sql`i.tier`)}
      AND i.cluster_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM cluster_splits split_audit
        WHERE split_audit.item_id = ${itemId}
          AND split_audit.from_cluster_id = i.cluster_id
      )
      AND i.published_at BETWEEN
          (SELECT published_at FROM target) - ${windowMs}
          AND
          (SELECT published_at FROM target) + ${windowMs}
    ORDER BY vector_distance_cos(i.embedding, (SELECT embedding FROM target))
    LIMIT 1
  `);

  const nearestClustered = nearestClusteredResult[0];

  // Only run the unclustered-neighbor query if the clustered one didn't give
  // us a within-threshold winner — saves one scan in the common case.
  const nearestUnclustered =
    nearestClustered && nearestClustered.distance <= threshold
      ? null
      : (
          await client.all<{ id: number; distance: number }>(sql`
          WITH target AS (
            SELECT
              embedding,
              published_at
            FROM items WHERE id = ${itemId}
          )
          SELECT
            i.id,
            vector_distance_cos(i.embedding, (SELECT embedding FROM target)) AS distance
          FROM items i
          WHERE i.id <> ${itemId}
            AND i.embedding IS NOT NULL
            AND i.enriched_at IS NOT NULL
            AND ${visibleTierInSql(sql`i.tier`)}
            AND i.cluster_id IS NULL
            AND i.published_at BETWEEN
                (SELECT published_at FROM target) - ${windowMs}
                AND
                (SELECT published_at FROM target) + ${windowMs}
          ORDER BY vector_distance_cos(i.embedding, (SELECT embedding FROM target))
          LIMIT 1
        `)
        )[0];

  let clusterId: number;
  let outcome: AssignOutcome;

  if (nearestClustered && nearestClustered.distance <= threshold) {
    // Bias: join the existing cluster even if an unclustered neighbor is
    // slightly closer. Trades best-mate optimality for cross-cluster recall.
    clusterId = nearestClustered.cluster_id;
    outcome = "assigned";
  } else if (nearestUnclustered && nearestUnclustered.distance <= threshold) {
    // No clustered neighbor close enough; promote the unclustered neighbor
    // to the lead of a new shared cluster.
    //
    // Race-safe sequence:
    //   1. Create cluster with member_count=0 (we haven't joined anyone yet).
    //   2. Try to claim the neighbor (the contended row) with a guarded UPDATE.
    //   3. If the claim succeeds → bump member_count to 1.
    //      If a concurrent worker beat us to the neighbor → repurpose this
    //      cluster as a singleton for itemId (lead points at itemId, not the
    //      lost neighbor) so we don't end up with a phantom 2-member count.
    // Atomic: create the shared cluster + claim the neighbor as its first
    // member + bump the count. As separate autocommit statements a crash
    // between claim and bump would drift member_count; one transaction closes
    // that window. Adding itemId (the second member) happens in
    // claimClusterAssignment's own transaction just below — a crash between the
    // two leaves a consistent single-member cluster, not drift.
    const promoted = await client.transaction(async (tx) => {
      const [created] = await tx
        .insert(clusters)
        .values({ leadItemId: nearestUnclustered.id, memberCount: 0, coverage: 0 })
        .returning({ id: clusters.id });

      const neighborClaim = await tx
        .update(items)
        .set({ clusterId: created.id, clusteredAt: new Date() })
        .where(
          sql`${items.id} = ${nearestUnclustered.id} AND ${items.clusteredAt} IS NULL`,
        )
        .returning({ id: items.id });

      if (neighborClaim.length > 0) {
        await tx
          .update(clusters)
          .set({
            memberCount: sql`${clusters.memberCount} + 1`,
            coverage: sql`${clusters.coverage} + 1`,
            latestMemberAt: new Date(),
          })
          .where(sql`${clusters.id} = ${created.id}`);
        return { clusterId: created.id, outcome: "assigned" as const };
      }
      // Neighbor was stolen mid-race. Repoint the cluster's lead to itemId
      // so it becomes a clean singleton when we join below; otherwise the
      // lead would dangle to a row that's now in some other cluster.
      await tx
        .update(clusters)
        .set({ leadItemId: itemId })
        .where(sql`${clusters.id} = ${created.id}`);
      return { clusterId: created.id, outcome: "created" as const };
    });
    clusterId = promoted.clusterId;
    outcome = promoted.outcome;
  } else {
    // No neighbor above threshold — new singleton cluster.
    return createSingletonCluster(client, itemId);
  }

  return claimClusterAssignment(client, itemId, clusterId, outcome);
}

async function countDistinctRejectedClusters(
  client: ClusterClient,
  itemId: number,
): Promise<number> {
  const result = await client.all<{ count: number | string | null }>(sql`
    SELECT count(DISTINCT split_audit.from_cluster_id) AS count
    FROM cluster_splits split_audit
    WHERE split_audit.item_id = ${itemId}
  `);
  return Number(result[0]?.count ?? 0);
}

async function createSingletonCluster(
  client: ClusterClient,
  itemId: number,
): Promise<AssignOutcome> {
  const [created] = await client
    .insert(clusters)
    .values({ leadItemId: itemId, memberCount: 0, coverage: 0 })
    .returning({ id: clusters.id });
  return claimClusterAssignment(client, itemId, created.id, "created");
}

async function claimClusterAssignment(
  client: ClusterClient,
  itemId: number,
  clusterId: number,
  outcome: Exclude<AssignOutcome, "already-claimed">,
): Promise<AssignOutcome> {
  // Claim + count-bump must be ATOMIC. As two autocommit statements, a crash or
  // timeout landing between them permanently drifts member_count — clusters
  // have no self-heal path (items self-heal via IS NULL claim predicates;
  // aggregates don't — see workers/cluster/reconcile.ts). One transaction
  // closes the window. The claim itself stays race-safe: only bump if the
  // guarded UPDATE actually assigned the item.
  return await client.transaction(async (tx) => {
    const claimed = await tx
      .update(items)
      .set({ clusterId, clusteredAt: new Date() })
      .where(sql`${items.id} = ${itemId} AND ${items.clusteredAt} IS NULL`)
      .returning({ id: items.id });

    if (claimed.length === 0) {
      // The cluster row is a zombie if WE created it in this call (created /
      // promote-neighbor lost-race / no-neighbor singleton paths) — we hold
      // an empty cluster row that no item will join. Clean it up. The "join
      // existing cluster" branch sets outcome to "assigned" with an existing
      // cluster_id, so we leave that alone (it has real members).
      if (outcome === "created") {
        await tx
          .delete(clusters)
          .where(
            sql`${clusters.id} = ${clusterId} AND ${clusters.memberCount} = 0`,
          );
      }
      return "already-claimed";
    }

    await tx
      .update(clusters)
      .set({
        memberCount: sql`${clusters.memberCount} + 1`,
        // coverage moves in lockstep with member_count (they are clones);
        // increment it too rather than recompute from member_count (the old
        // `member_count + 1` form non-deterministically half-healed drift).
        coverage: sql`${clusters.coverage} + 1`,
        latestMemberAt: new Date(),
        updatedAt: new Date(),
      })
      .where(sql`${clusters.id} = ${clusterId}`);

    return outcome;
  });
}
