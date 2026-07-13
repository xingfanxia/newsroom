/**
 * One-off: unlink existing digest/curation items from their clusters (W5.2).
 *
 * The pipeline change opts clustering_opt_out sources (群聊日报 / AI HOT) OUT
 * of clustering GOING FORWARD, but items already clustered before the change
 * stay put. This script unlinks them so existing digest contamination clears
 * immediately instead of only decaying as clusters churn. Unlinked digest
 * items become standalone feed cards (cluster_id NULL) — exactly the opt-out
 * end state; Stage A won't re-cluster them.
 *
 * After unlinking, it runs the standing reconciler (workers/cluster/reconcile)
 * to recompute the affected clusters' member_count / coverage / lead_item_id
 * and GC any cluster left empty — reusing tested repair logic rather than
 * hand-rolling aggregate math here.
 *
 * SCOPED reconcile (fixed 2026-07-12): the reconciler is passed
 * `clusterIds: affectedClusterIds` so it only repairs the clusters this script
 * actually touched. An UNSCOPED reconcile would also rewrite `latest_member_at`
 * on ~16k clusters carrying a pre-existing pg→Turso migration timestamp artifact
 * (member_count/coverage are clean; only latest_member_at diverges, up to ~172h)
 * — a large, unrelated feed-ordering / merge-window side effect that has nothing
 * to do with digest cleanup. That global artifact is a separate decision; this
 * migration must not drag it in.
 *
 * SAFE BY DEFAULT: dry-run unless `--apply` is passed. Turso is the only data
 * copy — take a backup (scripts/ops/db-dump.ts) before `--apply`.
 *
 * Run (preview):  bun --env-file=.env.local scripts/migrations/unlink-digest-cluster-members-20260712.ts
 * Run (apply):    bun --env-file=.env.local scripts/migrations/unlink-digest-cluster-members-20260712.ts --apply
 */
import { closeDb, libsqlClient } from "@/db/client";
import { reconcileClusters } from "@/workers/cluster/reconcile";

async function main() {
  const apply = process.argv.includes("--apply");
  const client = libsqlClient();

  // Digest/curation items still attached to a cluster.
  const doomed = await client.execute(`
    SELECT i.id AS item_id, i.cluster_id
    FROM items i
    JOIN sources s ON s.id = i.source_id
    WHERE s.clustering_opt_out = 1
      AND i.cluster_id IS NOT NULL
  `);

  const itemIds = doomed.rows.map((r) => Number(r.item_id));
  const affectedClusterIds = [
    ...new Set(doomed.rows.map((r) => Number(r.cluster_id))),
  ];

  console.log(
    `${apply ? "APPLY" : "DRY-RUN"}: ${itemIds.length} digest items in ` +
      `${affectedClusterIds.length} clusters would be unlinked.`,
  );

  if (!apply) {
    // Preview the reconcile that would follow, without writing. Scoped to the
    // clusters this script touches so the preview reflects the real (scoped)
    // apply, not a global 16k-cluster latest_member_at rewrite.
    const preview = await reconcileClusters({
      apply: false,
      clusterIds: affectedClusterIds,
      client,
    });
    console.log(
      `reconcile preview (post-unlink numbers are approximate — items not ` +
        `actually unlinked in dry-run): ${JSON.stringify(preview)}`,
    );
    return;
  }

  if (itemIds.length === 0) {
    console.log("nothing to unlink");
    return;
  }

  // Unlink in one set-based UPDATE (join back to opted-out sources so we only
  // touch the intended rows even though this runs as its own statement).
  const res = await client.execute(`
    UPDATE items
    SET cluster_id = NULL, clustered_at = NULL, cluster_verified_at = NULL
    WHERE cluster_id IS NOT NULL
      AND source_id IN (SELECT id FROM sources WHERE clustering_opt_out = 1)
  `);
  console.log(`unlinked ${res.rowsAffected} digest items`);

  // Repair every affected cluster's aggregates + leads; GC any now-empty ones.
  // Scoped to affectedClusterIds so this does NOT rewrite latest_member_at on
  // the ~16k clusters carrying the unrelated migration timestamp artifact.
  const rep = await reconcileClusters({
    apply: true,
    clusterIds: affectedClusterIds,
    client,
  });
  console.log(`reconcile: ${JSON.stringify(rep)}`);
  console.log("done");
}

if (import.meta.main) {
  main()
    .catch((err: unknown) => {
      console.error(
        "unlink-digest-cluster-members failed:",
        err instanceof Error ? err.message : String(err),
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeDb();
    });
}
