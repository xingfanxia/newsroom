import { sql, and, isNull, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import { items, clusters } from "@/db/schema";

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
 * Uses pgvector's `<=>` operator (cosine distance = 1 - cosine sim) for the
 * HNSW-indexed nearest-neighbor lookup.
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

async function assignOneToCluster(itemId: number): Promise<AssignOutcome> {
  const client = db();
  const threshold = 1 - SIMILARITY_THRESHOLD; // cosine sim → distance

  // Widened neighbor search: include ANY enriched+embedded item (not just ones
  // already clustered). If the nearest is unclustered-but-near, we promote it
  // to a cluster lead so near-duplicates in the same batch can still merge.
  // Window is anchored to the target item's own published_at (bidirectional
  // ±WINDOW_HOURS) so backfill items can find their temporal cohort even when
  // they arrive late.
  //
  // Verified items are NOT excluded from candidates — Stage A only ever ADDS
  // members to clusters, never reshuffles or splits, so a new item joining a
  // Stage-B-verified cluster is safe (the verified-lock protects existing
  // membership, not future joins). An earlier version of this query excluded
  // `cluster_verified_at IS NOT NULL` rows; that turned every multi-member
  // verified cluster into a recall black hole — the next item about the same
  // event couldn't see it and spawned a singleton.
  const nearestResult = await client.execute(sql`
    WITH target AS (
      SELECT embedding, published_at FROM items WHERE id = ${itemId}
    )
    SELECT
      i.id,
      i.cluster_id,
      i.clustered_at,
      (i.embedding <=> (SELECT embedding FROM target)) AS distance
    FROM items i
    WHERE i.id <> ${itemId}
      AND i.embedding IS NOT NULL
      AND i.enriched_at IS NOT NULL
      AND i.published_at BETWEEN
          (SELECT published_at FROM target) - make_interval(hours => ${WINDOW_HOURS})
          AND
          (SELECT published_at FROM target) + make_interval(hours => ${WINDOW_HOURS})
    ORDER BY i.embedding <=> (SELECT embedding FROM target)
    LIMIT 1
  `);

  // postgres-js's drizzle adapter returns a RowList that extends Array<T>;
  // it has NO `.rows` property. Indexing as an array is the correct shape.
  const nearestRows = nearestResult as unknown as Array<{
    id: number;
    cluster_id: number | null;
    clustered_at: Date | null;
    distance: number;
  }>;
  const nearest = nearestRows[0];

  let clusterId: number;
  let outcome: AssignOutcome;

  if (nearest && nearest.distance <= threshold) {
    if (nearest.cluster_id != null) {
      // Neighbor already in a cluster — join it.
      clusterId = nearest.cluster_id;
      outcome = "assigned";
    } else {
      // Neighbor is enriched but not yet clustered. Try to atomically claim
      // it as the lead of a new shared cluster.
      //
      // Race-safe sequence:
      //   1. Create cluster with member_count=0 (we haven't joined anyone yet).
      //   2. Try to claim the neighbor (the contended row) with a guarded UPDATE.
      //   3. If the claim succeeds → bump member_count to 1.
      //      If a concurrent worker beat us to the neighbor → repurpose this
      //      cluster as a singleton for itemId (lead points at itemId, not the
      //      lost neighbor) so we don't end up with a phantom 2-member count.
      const [created] = await client
        .insert(clusters)
        .values({ leadItemId: nearest.id, memberCount: 0 })
        .returning({ id: clusters.id });
      clusterId = created.id;

      const neighborClaim = await client
        .update(items)
        .set({ clusterId, clusteredAt: new Date() })
        .where(sql`${items.id} = ${nearest.id} AND ${items.clusteredAt} IS NULL`)
        .returning({ id: items.id });

      if (neighborClaim.length > 0) {
        await client
          .update(clusters)
          .set({ memberCount: sql`${clusters.memberCount} + 1` })
          .where(sql`${clusters.id} = ${clusterId}`);
        outcome = "assigned";
      } else {
        // Neighbor was stolen mid-race. Repoint the cluster's lead to itemId
        // so it becomes a clean singleton when we join below; otherwise the
        // lead would dangle to a row that's now in some other cluster.
        await client
          .update(clusters)
          .set({ leadItemId: itemId })
          .where(sql`${clusters.id} = ${clusterId}`);
        outcome = "created";
      }
    }
  } else {
    // No neighbor above threshold — new singleton cluster.
    const [created] = await client
      .insert(clusters)
      .values({ leadItemId: itemId, memberCount: 0 })
      .returning({ id: clusters.id });
    clusterId = created.id;
    outcome = "created";
  }

  // Atomic claim: only increment member_count if we successfully assigned the item.
  // If another worker beat us to this row, the UPDATE returns 0 rows and we
  // silently no-op instead of double-counting.
  const claimed = await client
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
      await client
        .delete(clusters)
        .where(sql`${clusters.id} = ${clusterId} AND ${clusters.memberCount} = 0`);
    }
    return "already-claimed";
  }

  await client
    .update(clusters)
    .set({
      memberCount: sql`${clusters.memberCount} + 1`,
      latestMemberAt: new Date(),
      coverage: sql`${clusters.memberCount} + 1`,
      updatedAt: new Date(),
    })
    .where(sql`${clusters.id} = ${clusterId}`);

  return outcome;
}
