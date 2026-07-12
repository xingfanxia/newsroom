/**
 * One-off prod-data repair for the 2026-07-12 cluster audit findings.
 *
 * Three cleanups. Steps 1-2 are idempotent (recompute-from-truth / dedupe — a
 * second run changes nothing). Step 3 is a ONE-TIME unstick, not idempotent:
 * it force-clears the verdict locks, so re-running it after the pipeline has
 * re-arbitrated/re-titled those clusters would blank them again and burn
 * another LLM round. This is a one-shot repair, run once with --apply.
 *   1. Reconcile ALL cluster aggregates — recompute member_count / coverage /
 *      latest_member_at from actual membership, GC zombie (0-member) clusters,
 *      re-point dangling lead_item_id to a real member. This fixes the audit's
 *      migration-artifact drift (clusters 48878/48949/48959/48982/48997 + the
 *      empty 49009) AND the ~11 dangling-lead clusters, plus anything else that
 *      drifted the same way. Uses the same reconciler as
 *      `cluster-health --repair`.
 *   2. Dedupe `cluster_splits` — keep the earliest row per
 *      (item_id, from_cluster_id). REQUIRED before db:optimize can create the
 *      `cluster_splits_item_cluster_uq` unique index (the historical split-loop
 *      appended the same pair thousands of times; top pair 2,174×).
 *   3. Clear verified_at/titled_at on the 5 formerly-stuck clusters so the next
 *      pipeline tick re-arbitrates + re-titles them (they were excluded from
 *      arbitration for weeks by the mc=1 drift).
 *
 * Safety: --dry-run by default (reports counts, writes nothing); --apply to
 * write. A full backup was taken before this ran (scripts/ops/db-dump.ts;
 * see docs/ops/db-backup-restore.md). After --apply, run `bun run db:optimize`
 * to create the unique index, then verify with cluster-health.
 *
 * Run: bun --env-file=.env.local scripts/migrations/repair-cluster-drift-20260712.ts [--apply]
 */
import { libsqlClient, closeDb } from "@/db/client";
import { reconcileClusters } from "@/workers/cluster/reconcile";

const APPLY = process.argv.includes("--apply");
/** Clusters the audit found stuck at mc=1 (excluded from arbitration/titles).
 *  After reconcile corrects their counts, clear the verdict locks so the
 *  pipeline re-processes them. 49009 is the empty zombie — deleted by the
 *  reconciler's zombie pass, not listed here. */
const STUCK_IDS = [48878, 48949, 48959, 48982, 48997];
const SAMPLE_IDS = [...STUCK_IDS, 49009];

async function snapshot(label: string) {
  const client = libsqlClient();
  const res = await client.execute(`
    SELECT c.id,
           c.member_count AS mc,
           (SELECT count(*) FROM items i WHERE i.cluster_id = c.id) AS actual,
           c.coverage AS cov,
           (c.verified_at IS NOT NULL) AS verified,
           (c.titled_at IS NOT NULL) AS titled,
           (NOT EXISTS (SELECT 1 FROM items i
             WHERE i.id = c.lead_item_id AND i.cluster_id = c.id)) AS dangling_lead
    FROM clusters c WHERE c.id IN (${SAMPLE_IDS.join(",")})
    ORDER BY c.id
  `);
  console.log(`\n[${label}] audit-sample clusters:`);
  if (res.rows.length === 0) {
    console.log("  (none of the sample ids exist — already reconciled/deleted)");
  }
  for (const r of res.rows) {
    console.log(
      `  cluster ${r.id}: member_count=${r.mc} actual=${r.actual} coverage=${r.cov} ` +
        `verified=${r.verified} titled=${r.titled} dangling_lead=${r.dangling_lead}`,
    );
  }
}

async function main() {
  const client = libsqlClient();
  console.log(
    `repair-cluster-drift-20260712 — ${APPLY ? "APPLY (writing)" : "DRY-RUN (pass --apply to write)"}`,
  );

  await snapshot("before");

  // 1. Reconcile all cluster aggregates / zombies / dangling leads.
  const rep = await reconcileClusters({ apply: APPLY });
  console.log(
    `\n[reconcile] ${APPLY ? "applied" : "would apply"}: ` +
      `orphanItemsUnlinked=${rep.orphanItemsUnlinked} ` +
      `aggregatesFixed=${rep.aggregatesFixed} zombiesDeleted=${rep.zombiesDeleted} ` +
      `leadsRepointed=${rep.leadsRepointed}`,
  );

  // 2. Dedupe cluster_splits (keep earliest id per pair).
  const dupWhere = `EXISTS (
    SELECT 1 FROM cluster_splits cs2
    WHERE cs2.item_id = cluster_splits.item_id
      AND cs2.from_cluster_id = cluster_splits.from_cluster_id
      AND cs2.id < cluster_splits.id
  )`;
  if (APPLY) {
    const d = await client.execute(`DELETE FROM cluster_splits WHERE ${dupWhere}`);
    console.log(`[cluster_splits] deleted ${d.rowsAffected} duplicate rows`);
  } else {
    const d = await client.execute(
      `SELECT count(*) AS n FROM cluster_splits WHERE ${dupWhere}`,
    );
    console.log(
      `[cluster_splits] ${Number(d.rows[0].n)} duplicate rows would be deleted ` +
        `(→ then 'bun run db:optimize' creates cluster_splits_item_cluster_uq)`,
    );
  }

  // 3. Unstick the formerly-drifted clusters so the pipeline re-processes them.
  if (APPLY) {
    const u = await client.execute({
      sql: `UPDATE clusters SET verified_at = NULL, titled_at = NULL, updated_at = ?
            WHERE id IN (${STUCK_IDS.join(",")})`,
      args: [Date.now()],
    });
    console.log(`[re-arbitrate] cleared verified/titled on ${u.rowsAffected} clusters`);
  } else {
    const u = await client.execute(
      `SELECT count(*) AS n FROM clusters
       WHERE id IN (${STUCK_IDS.join(",")})
         AND (verified_at IS NOT NULL OR titled_at IS NOT NULL)`,
    );
    console.log(`[re-arbitrate] ${Number(u.rows[0].n)} clusters would be cleared`);
  }

  if (APPLY) await snapshot("after");

  await closeDb();
  console.log(`\nREPAIR ${APPLY ? "APPLIED" : "DRY-RUN"} DONE`);
}

main().catch((e) => {
  console.error("repair failed:", e);
  process.exit(1);
});
