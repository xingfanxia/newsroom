/**
 * Throwaway: drain canonical-title regeneration locally.
 *
 * After scripts/migrations/recompute-cluster-leads.ts nullifies titled_at on
 * 241 multi-member clusters, the production cron (15 titles/run @ 30 min)
 * needs ~16 ticks to drain — and uses the OLD prompt until the PR deploys.
 *
 * This script runs the LOCAL Stage C (with the new authority-aware lead +
 * anti-bias prompt) against the production DB, draining the queue in one
 * pass. ~241 Haiku calls × ~1s each = ~4 minutes.
 */
import { runCanonicalTitleBatch } from "@/workers/cluster/canonical-title";
import { closeDb } from "@/db/client";

const MAX_BATCHES = 30; // 30 × 15 = 450, more than enough for 241

async function main() {
  let total = 0;
  let totalErrors = 0;
  const started = Date.now();

  for (let i = 1; i <= MAX_BATCHES; i++) {
    const report = await runCanonicalTitleBatch();
    total += report.generated;
    totalErrors += report.errors.length;

    console.log(
      `  batch ${i}: processed=${report.processed} generated=${report.generated} errors=${report.errors.length} duration=${report.durationMs}ms`,
    );
    for (const err of report.errors) {
      console.error(`    ! cluster ${err.clusterId}: ${err.reason}`);
    }

    if (report.processed === 0) {
      console.log(`\n  queue drained after ${i} batches.`);
      break;
    }
  }

  console.log(
    `\ndone — ${total} titles regenerated, ${totalErrors} errors, ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
  await closeDb();
}

await main();
