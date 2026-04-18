#!/usr/bin/env bun
/**
 * Drain loop — runs the normalizer repeatedly until raw_items backlog is empty.
 *
 * The normalizer processes MAX_PER_RUN=200 rows/invocation to stay under
 * Vercel's function budget. Backfill drops thousands of raw rows in one go,
 * so waiting for the hourly cron to chew through them would take ~days.
 * This script just keeps hitting runNormalizer() locally until done.
 *
 * Usage: bun --env-file=.env.local scripts/ops/drain-normalizer.ts
 */
import { runNormalizer } from "@/workers/normalizer";
import { closeDb } from "@/db/client";

async function main() {
  let totalCreated = 0;
  let totalDeduped = 0;
  let totalSkipped = 0;
  let totalErrored = 0;
  let iterations = 0;
  const started = Date.now();

  for (;;) {
    iterations++;
    const report = await runNormalizer();
    totalCreated += report.created;
    totalDeduped += report.dedupedByHash;
    totalSkipped += report.skipped;
    totalErrored += report.errored;

    console.log(
      `  [iter ${String(iterations).padStart(3)}] processed=${report.processed} created=${report.created} deduped=${report.dedupedByHash} skipped=${report.skipped} errored=${report.errored} (${report.durationMs}ms)`,
    );
    if (report.processed === 0) break;
    if (iterations > 100) {
      console.log("  guard: hit 100 iterations, stopping to avoid runaway");
      break;
    }
  }

  const elapsedS = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `\ndone — iterations=${iterations} created=${totalCreated} deduped=${totalDeduped} skipped=${totalSkipped} errored=${totalErrored} (${elapsedS}s)`,
  );

  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
