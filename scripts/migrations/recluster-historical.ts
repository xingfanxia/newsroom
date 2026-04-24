#!/usr/bin/env bun
/**
 * One-time backfill: re-cluster all historical items under the tuned Stage A
 * params (0.80 threshold, ±72h published-anchored window).
 *
 * The tuned clustering only affects items where clustered_at IS NULL — every
 * existing item is already claimed as a singleton, so without this script the
 * backtest's predicted ~573 cross-source merges never form. This script:
 *
 *   1. Snapshots the existing clusters → items mapping to a JSONL backup so
 *      the operation is reversible (operator can re-link items if anything
 *      catastrophic happens).
 *   2. DELETE FROM clusters and clears items.cluster_id / clustered_at /
 *      cluster_verified_at across the whole table.
 *   3. Loops runClusterBatch() until the queue is empty (no more items with
 *      clustered_at IS NULL). Each batch processes up to 200 items.
 *
 * After this, run scripts/migrations/events-from-clusters.ts to lift the
 * editorial fields onto the freshly formed clusters.
 *
 * Usage:
 *   bun --env-file=.env.local scripts/migrations/recluster-historical.ts [--dry-run]
 *   bun --env-file=.env.local scripts/migrations/recluster-historical.ts --resume
 *     # Skip the destructive reset; just keep running Stage A until empty.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import { db, closeDb } from "@/db/client";
import { runClusterBatch } from "@/workers/cluster";

type Args = { dryRun: boolean; resume: boolean };

function parseArgs(argv: string[]): Args {
  return {
    dryRun: argv.includes("--dry-run"),
    resume: argv.includes("--resume"),
  };
}

type ClusterSnapshot = {
  id: number;
  lead_item_id: number;
  member_count: number;
};

type ItemSnapshot = {
  id: number;
  cluster_id: number | null;
  clustered_at: string | null;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const client = db();

  // Bumped statement_timeout for the deletes/updates which scan the items table.
  await client.execute(sql`SET statement_timeout = '600s'`);

  console.log(args.dryRun ? "🔍 DRY RUN" : args.resume ? "▶ RESUME" : "🚀 RECLUSTER");

  // Pre-flight.
  const preRows = (await client.execute(sql`
    SELECT
      (SELECT count(*) FROM clusters)::int AS cluster_count,
      (SELECT count(*) FROM items WHERE cluster_id IS NOT NULL)::int AS clustered_items,
      (SELECT count(*) FROM items
        WHERE clustered_at IS NULL
          AND embedding IS NOT NULL
          AND enriched_at IS NOT NULL)::int AS pending_recluster
  `)) as unknown as Array<{
    cluster_count: number;
    clustered_items: number;
    pending_recluster: number;
  }>;
  const pre = preRows[0];

  console.log("\n=== Pre-flight ===");
  console.log(`  current clusters:            ${pre.cluster_count}`);
  console.log(`  currently clustered items:   ${pre.clustered_items}`);
  console.log(`  items pending recluster now: ${pre.pending_recluster}`);

  if (args.dryRun) {
    await closeDb();
    return;
  }

  if (!args.resume) {
    // ── Step 1. Snapshot before destruction ──────────────────────────────────
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const backupDir = resolve(`docs/reports/recluster-${ts}`);
    mkdirSync(backupDir, { recursive: true });
    console.log(`\n=== Snapshot to ${backupDir} ===`);

    const clustersDump = (await client.execute(sql`
      SELECT id, lead_item_id, member_count FROM clusters
    `)) as unknown as ClusterSnapshot[];
    writeFileSync(
      resolve(backupDir, "clusters.jsonl"),
      clustersDump.map((c) => JSON.stringify(c)).join("\n"),
    );
    console.log(`  ${clustersDump.length} clusters snapshotted`);

    const itemsDump = (await client.execute(sql`
      SELECT id, cluster_id, clustered_at::text AS clustered_at
      FROM items
      WHERE cluster_id IS NOT NULL
    `)) as unknown as ItemSnapshot[];
    writeFileSync(
      resolve(backupDir, "items-cluster.jsonl"),
      itemsDump.map((i) => JSON.stringify(i)).join("\n"),
    );
    console.log(`  ${itemsDump.length} items snapshotted`);

    // ── Step 2. Clear cluster state ──────────────────────────────────────────
    console.log("\n=== Reset ===");
    await client.execute(sql`
      UPDATE items
      SET cluster_id = NULL,
          clustered_at = NULL,
          cluster_verified_at = NULL
      WHERE cluster_id IS NOT NULL
         OR clustered_at IS NOT NULL
         OR cluster_verified_at IS NOT NULL
    `);
    console.log("  items.cluster_id / clustered_at / cluster_verified_at cleared");

    // cluster_splits has FK on items(id) ON DELETE cascade, but FK on
    // clusters is NOT defined (per schema comment about circular dep), so
    // deleting clusters won't cascade to cluster_splits. Truncate it too —
    // the audit history was for clusters that no longer exist.
    await client.execute(sql`TRUNCATE TABLE cluster_splits`);
    console.log("  cluster_splits truncated");

    await client.execute(sql`DELETE FROM clusters`);
    console.log("  clusters cleared");
  }

  // ── Step 3. Re-run Stage A in a loop until queue drains ──────────────────
  console.log("\n=== Stage A reclustering ===");
  let totalProcessed = 0;
  let totalAssigned = 0;
  let totalNewClusters = 0;
  let iteration = 0;
  const startedAt = Date.now();

  while (true) {
    iteration++;
    const report = await runClusterBatch();
    if (report.processed === 0) break;

    totalProcessed += report.processed;
    totalAssigned += report.assigned;
    totalNewClusters += report.newClusters;
    const errs = report.errors?.length ?? 0;
    console.log(
      `  batch ${iteration}: processed=${report.processed} assigned=${report.assigned} new=${report.newClusters} errors=${errs} (${report.durationMs}ms)`,
    );

    // Safety bound — if something is wrong, don't burn through CPU forever.
    if (iteration > 200) {
      console.warn("  bailing after 200 iterations");
      break;
    }
  }

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n  total: processed=${totalProcessed} assigned=${totalAssigned} new=${totalNewClusters} (${elapsedSec}s)`);

  // ── Step 4. Post-flight ──────────────────────────────────────────────────
  const postRows = (await client.execute(sql`
    SELECT
      (SELECT count(*) FROM clusters)::int AS clusters,
      (SELECT count(*) FROM clusters WHERE member_count >= 2)::int AS multi_member,
      (SELECT count(*) FROM clusters WHERE member_count = 1)::int AS singletons,
      (SELECT count(*) FROM items WHERE cluster_id IS NOT NULL)::int AS clustered_items,
      (SELECT count(*) FROM items
        WHERE clustered_at IS NULL
          AND embedding IS NOT NULL
          AND enriched_at IS NOT NULL)::int AS still_pending
  `)) as unknown as Array<{
    clusters: number;
    multi_member: number;
    singletons: number;
    clustered_items: number;
    still_pending: number;
  }>;
  const post = postRows[0];

  console.log("\n=== Post-flight ===");
  console.log(`  total clusters:          ${post.clusters}`);
  console.log(`  multi-member clusters:   ${post.multi_member}`);
  console.log(`  singleton clusters:      ${post.singletons}`);
  console.log(`  clustered items:         ${post.clustered_items}`);
  console.log(`  still-pending items:     ${post.still_pending}`);

  if (post.multi_member > 0) {
    console.log(
      `\n✓ ${post.multi_member} multi-member clusters formed. Run scripts/migrations/events-from-clusters.ts next to lift event-level fields.`,
    );
  } else {
    console.log("\n⚠ No multi-member clusters formed. Verify HNSW index + threshold.");
  }

  await closeDb();
}

main().catch(async (err) => {
  console.error("Recluster failed:", err);
  await closeDb();
  process.exit(1);
});
