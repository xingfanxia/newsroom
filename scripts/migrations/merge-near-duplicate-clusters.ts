/**
 * CLI wrapper around `runMergeBatch` (workers/cluster/merge.ts) — manual
 * cluster-merge runs for backfill or operator-initiated cleanups.
 *
 * Same logic also runs as a stage in the cluster cron pipeline (between
 * Stage B arbitrate and Stage C canonical-title) at a tight 6h recency
 * window. Use this CLI when you want a wider window or a dry-run preview.
 *
 * Usage:
 *   bun run scripts/migrations/merge-near-duplicate-clusters.ts                  # dry-run, last 72h
 *   bun run scripts/migrations/merge-near-duplicate-clusters.ts --apply          # commit
 *   bun run scripts/migrations/merge-near-duplicate-clusters.ts --hours 168 --apply
 *   bun run scripts/migrations/merge-near-duplicate-clusters.ts --all            # all multi-member clusters
 */

import { closeDb } from "@/db/client";
import {
  runMergeBatch,
  MERGE_MIN_DISTANCE,
  MERGE_MEAN_DISTANCE,
  MERGE_PAIRS_WITHIN_FRACTION,
} from "@/workers/cluster/merge";

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
      : 72;
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new Error(`invalid --hours value: ${args[hoursIdx + 1]}`);
  }
  return { apply, hours };
}

async function main() {
  const { apply, hours } = parseFlags();

  console.log(
    `[merge-clusters] mode=${apply ? "APPLY" : "DRY-RUN"} window=${hours == null ? "ALL" : `${hours}h`} threshold=min≤${MERGE_MIN_DISTANCE} mean≤${MERGE_MEAN_DISTANCE} pairs_within≥${(MERGE_PAIRS_WITHIN_FRACTION * 100).toFixed(0)}%`,
  );

  const report = await runMergeBatch({
    recencyHours: hours,
    dryRun: !apply,
    onMerge: (m) => {
      const sim = (1 - m.meanDistance).toFixed(3);
      console.log(
        `  merge cluster ${m.loserId} (${m.sizeLoser} members) → cluster ${m.winnerId} (${m.sizeWinner} members)`,
      );
      console.log(
        `    min=${m.minDistance.toFixed(3)} mean=${m.meanDistance.toFixed(3)} (sim ≈ ${sim}) pairs_within=${m.pairsWithin}/${m.totalPairs}`,
      );
    },
  });

  console.log("\n[merge-clusters] summary");
  console.log(`  pairs evaluated:    ${report.candidatePairs}`);
  console.log(`  merges executed:    ${report.mergesExecuted}`);
  console.log(`  items moved:        ${report.itemsMoved}`);
  console.log(`  skipped (transitive): ${report.skipped}`);
  console.log(`  errors:             ${report.errors.length}`);
  for (const err of report.errors) {
    console.error(
      `    ! ${err.winnerId} ← ${err.loserId}: ${err.reason}`,
    );
  }
  if (!apply && report.mergesExecuted > 0) {
    console.log(`\n  re-run with --apply to commit.`);
  }
  await closeDb();
}

await main();
