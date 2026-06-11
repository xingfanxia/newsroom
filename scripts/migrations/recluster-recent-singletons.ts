/**
 * Re-cluster singleton items that should have joined another event cluster.
 *
 * Thin CLI wrapper around `runSingletonReclusterBatch` so manual backfills
 * and the production cron share the same eligibility and mutation logic.
 *
 * Usage:
 *   bun run scripts/migrations/recluster-recent-singletons.ts             # dry-run, last 48h
 *   bun run scripts/migrations/recluster-recent-singletons.ts --apply     # actually mutate
 *   bun run scripts/migrations/recluster-recent-singletons.ts --hours 72  # widen window
 *   bun run scripts/migrations/recluster-recent-singletons.ts --all       # all singletons, no time bound
 */

import { closeDb } from "@/db/client";
import {
  runSingletonReclusterBatch,
  SINGLETON_RECLUSTER_SIMILARITY_THRESHOLD,
} from "@/workers/cluster/singletons";

type CliFlags = { apply: boolean; hours: number | null };

function parseFlags(): CliFlags {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const all = args.includes("--all");
  if (all) return { apply, hours: null };

  const hoursIdx = args.indexOf("--hours");
  const hours =
    hoursIdx >= 0 && args[hoursIdx + 1]
      ? Number.parseInt(args[hoursIdx + 1], 10)
      : 48;
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new Error(`invalid --hours value: ${args[hoursIdx + 1]}`);
  }
  return { apply, hours };
}

async function main() {
  const { apply, hours } = parseFlags();
  const mergesByTarget = new Map<number, number>();

  console.log(
    `[recluster-singletons] mode=${apply ? "APPLY" : "DRY-RUN"} window=${hours == null ? "ALL" : `${hours}h`} threshold=sim>=${SINGLETON_RECLUSTER_SIMILARITY_THRESHOLD}`,
  );

  const report = await runSingletonReclusterBatch({
    recencyHours: hours,
    maxPerRun: null,
    dryRun: !apply,
    onMove: (move) => {
      mergesByTarget.set(
        move.targetClusterId,
        (mergesByTarget.get(move.targetClusterId) ?? 0) + 1,
      );
      console.log(
        `  item ${move.itemId} (cluster ${move.fromClusterId} singleton) -> cluster ${move.targetClusterId} (sim=${move.similarity.toFixed(3)}) - "${move.title}"`,
      );
    },
  });

  console.log("\n[recluster-singletons] summary");
  console.log(`  processed: ${report.processed}`);
  console.log(`  merged: ${report.merged}`);
  console.log(`  kept: ${report.kept}`);
  console.log(`  errors: ${report.errors.length}`);
  if (mergesByTarget.size > 0) {
    const top = [...mergesByTarget.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    console.log("  top targets:");
    for (const [cid, n] of top) {
      console.log(`    cluster ${cid}: +${n} members`);
    }
  }
  if (!apply && report.merged > 0) {
    console.log("\n  re-run with --apply to commit.");
  }
  if (report.errors.length > 0) {
    for (const error of report.errors.slice(0, 10)) {
      console.error(`  ! item ${error.itemId} failed: ${error.reason}`);
    }
  }
}

try {
  await main();
} finally {
  await closeDb();
}
