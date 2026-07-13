import { sql, type SQL } from "drizzle-orm";

/**
 * SQL predicate: the item aliased `alias` is NOT from a clustering-opted-out
 * source (W5.2). Digest / curation feeds (群聊日报 / AI HOT) are multi-topic,
 * not single-event coverage — clustering them bridged unrelated events via
 * single-link chaining and inflated the coverage boost. Use this inside the
 * WHERE clause of every Stage A / A.5 candidate + neighbor query so opt-out
 * items are neither clustered themselves nor act as a neighbor magnet that
 * pulls unrelated items together. Opt-out items still render as standalone
 * feed cards; they just never join or bridge a cluster.
 *
 * `alias` is the table alias used in the surrounding query (e.g. "i" or
 * "items"). Emitted as a correlated NOT EXISTS so it composes with either the
 * drizzle query builder or a raw `sql` template.
 */
export function notClusteringOptedOut(alias: string): SQL {
  return sql`NOT EXISTS (
    SELECT 1 FROM sources s
    WHERE s.id = ${sql.raw(alias)}.source_id AND s.clustering_opt_out = 1
  )`;
}
