import { sql, and, isNull, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import { items, clusters } from "@/db/schema";

const MAX_PER_RUN = 200;
const SIMILARITY_THRESHOLD = 0.88;
const WINDOW_HOURS = 48;

export type ClusterReport = {
  processed: number;
  assigned: number;
  newClusters: number;
  durationMs: number;
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

  for (const p of pending) {
    // Nearest neighbor: find another clustered item within window that's the
    // lead of its cluster (or closest to this item). We use items.cluster_id
    // to find an existing cluster, and pgvector `<->` to get the cosine distance.
    // Simpler approach: find nearest enriched neighbor OVERALL, if it's clustered,
    // join that cluster; otherwise create a new one.
    const threshold = 1 - SIMILARITY_THRESHOLD; // convert sim → distance

    const nearest = await client.execute(sql`
      SELECT
        i.id,
        i.cluster_id,
        (i.embedding <=> (SELECT embedding FROM items WHERE id = ${p.id})) AS distance
      FROM items i
      WHERE i.id <> ${p.id}
        AND i.embedding IS NOT NULL
        AND i.clustered_at IS NOT NULL
        AND i.clustered_at > now() - (${WINDOW_HOURS}::text || ' hours')::interval
      ORDER BY i.embedding <=> (SELECT embedding FROM items WHERE id = ${p.id})
      LIMIT 1
    `);

    const row = (nearest as { rows?: unknown[] }).rows?.[0] as
      | { id: number; cluster_id: number | null; distance: number }
      | undefined;

    let clusterId: number;

    if (row && row.distance <= threshold && row.cluster_id != null) {
      // Join existing cluster
      clusterId = row.cluster_id;
      await client
        .update(clusters)
        .set({
          memberCount: sql`${clusters.memberCount} + 1`,
          updatedAt: new Date(),
        })
        .where(sql`${clusters.id} = ${clusterId}`);
      assigned++;
    } else {
      // New single-member cluster
      const [created] = await client
        .insert(clusters)
        .values({ leadItemId: p.id, memberCount: 1 })
        .returning({ id: clusters.id });
      clusterId = created.id;
      newClusters++;
    }

    await client
      .update(items)
      .set({ clusterId, clusteredAt: new Date() })
      .where(sql`${items.id} = ${p.id}`);
  }

  return {
    processed: pending.length,
    assigned,
    newClusters,
    durationMs: Date.now() - started,
  };
}
