/**
 * Cluster aggregate reconciler — the standing repair for denormalized cluster
 * bookkeeping (member_count / coverage / latest_member_at / lead_item_id).
 *
 * WHY: the cluster row caches counts that must equal reality
 * (`member_count == COUNT(items WHERE cluster_id = c.id)`). Items self-heal via
 * `IS NULL` claim predicates; cluster aggregates have no such path, so a
 * non-transactional claim+bump crash — or, as of 2026-07-12, a migration copy
 * artifact — leaves the cache drifted forever. Drifted clusters get silently
 * excluded from arbitration/titling (`member_count >= 2` gates), and a cluster
 * whose `lead_item_id` isn't one of its own members renders NOTHING on the feed
 * (the dedup predicate `cluster_id IS NULL OR lead_item_id = items.id`).
 *
 * This module recomputes every cached aggregate from actual membership. It is
 * idempotent (a second run over clean data changes nothing) and set-based (a
 * fixed handful of statements, not N round-trips). Drift it finds is an ALARM,
 * not a fact of life — callers log loudly.
 *
 * It deliberately does NOT touch `verified_at` / `titled_at`: forcing
 * re-arbitration/re-titling costs LLM calls and is the caller's decision (the
 * 2026-07-12 one-off migration does it for its specific stuck clusters; the
 * weekly reconciler must not).
 */
import { libsqlClient } from "@/db/client";

export type ReconcileReport = {
  apply: boolean;
  aggregatesFixed: number;
  zombiesDeleted: number;
  leadsRepointed: number;
};

export type ReconcileOpts = {
  /** false = dry-run (report only). true = write. */
  apply: boolean;
  /** Scope to specific cluster ids. Undefined = all clusters. */
  clusterIds?: number[];
  /**
   * Skip deleting empty clusters newer than this many ms (default 5min) so the
   * reconciler can't race Stage A, which briefly holds a member_count=0 row
   * between creating a cluster and claiming its first item.
   */
  zombieMinAgeMs?: number;
};

/** Build a `<col> IN (?, ?, …)` scope fragment (or "1=1" for all). */
function scope(clusterIds: number[] | undefined, col = "clusters.id"): {
  clause: string;
  args: number[];
} {
  if (!clusterIds || clusterIds.length === 0) return { clause: "1=1", args: [] };
  const placeholders = clusterIds.map(() => "?").join(", ");
  return { clause: `${col} IN (${placeholders})`, args: [...clusterIds] };
}

export async function reconcileClusters(
  opts: ReconcileOpts,
): Promise<ReconcileReport> {
  const client = libsqlClient();
  const now = Date.now();
  const minAge = opts.zombieMinAgeMs ?? 5 * 60_000;
  const s = scope(opts.clusterIds);

  // ── 1. Zombie clusters: no members at all → GC the row. Age-guarded so we
  //     don't delete an in-flight Stage-A cluster mid-creation. cluster_splits
  //     has no FK to clusters, so this is safe; items have none pointing here
  //     by definition (that's what makes it a zombie).
  const zombieWhere = `${s.clause}
    AND NOT EXISTS (SELECT 1 FROM items i WHERE i.cluster_id = clusters.id)
    AND clusters.first_seen_at < ?`;
  const zombieArgs = [...s.args, now - minAge];

  let zombiesDeleted: number;
  if (opts.apply) {
    const r = await client.execute({
      sql: `DELETE FROM clusters WHERE ${zombieWhere}`,
      args: zombieArgs,
    });
    zombiesDeleted = r.rowsAffected;
  } else {
    const r = await client.execute({
      sql: `SELECT count(*) AS n FROM clusters WHERE ${zombieWhere}`,
      args: zombieArgs,
    });
    zombiesDeleted = Number(r.rows[0].n);
  }

  // ── 2. Aggregate drift: member_count / coverage / latest_member_at != truth.
  //     Recompute all three from actual membership in one set-based UPDATE.
  //     (Runs after the zombie delete so it only touches surviving clusters.)
  const actual = `(SELECT count(*) FROM items i WHERE i.cluster_id = clusters.id)`;
  const driftWhere = `${s.clause} AND (
       clusters.member_count <> ${actual}
    OR clusters.coverage <> ${actual}
  )`;

  let aggregatesFixed: number;
  if (opts.apply) {
    const r = await client.execute({
      sql: `UPDATE clusters SET
              member_count = ${actual},
              coverage = ${actual},
              latest_member_at = (SELECT max(i.clustered_at) FROM items i WHERE i.cluster_id = clusters.id),
              updated_at = ?
            WHERE ${driftWhere}`,
      args: [now, ...s.args],
    });
    aggregatesFixed = r.rowsAffected;
  } else {
    const r = await client.execute({
      sql: `SELECT count(*) AS n FROM clusters WHERE ${driftWhere}`,
      args: s.args,
    });
    aggregatesFixed = Number(r.rows[0].n);
  }

  // ── 3. Dangling leads: lead_item_id isn't one of the cluster's own members
  //     → the feed dedup hides the cluster entirely. Re-point to the strongest
  //     surviving member (importance DESC — SQLite sorts NULLs last under DESC;
  //     earliest published wins ties; lowest id is the deterministic backstop).
  //     Stage C's authority-aware pickBestLead refines this on the next retitle.
  const danglingWhere = `${s.clause}
    AND EXISTS (SELECT 1 FROM items i WHERE i.cluster_id = clusters.id)
    AND NOT EXISTS (
      SELECT 1 FROM items i
      WHERE i.id = clusters.lead_item_id AND i.cluster_id = clusters.id
    )`;

  let leadsRepointed: number;
  if (opts.apply) {
    const r = await client.execute({
      sql: `UPDATE clusters SET
              lead_item_id = (
                SELECT i.id FROM items i WHERE i.cluster_id = clusters.id
                ORDER BY i.importance DESC, i.published_at ASC, i.id ASC LIMIT 1
              ),
              updated_at = ?
            WHERE ${danglingWhere}`,
      args: [now, ...s.args],
    });
    leadsRepointed = r.rowsAffected;
  } else {
    const r = await client.execute({
      sql: `SELECT count(*) AS n FROM clusters WHERE ${danglingWhere}`,
      args: s.args,
    });
    leadsRepointed = Number(r.rows[0].n);
  }

  return { apply: opts.apply, aggregatesFixed, zombiesDeleted, leadsRepointed };
}
