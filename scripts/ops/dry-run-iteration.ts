#!/usr/bin/env bun
/**
 * Dev-only dry-run: invokes the M4 iteration agent end-to-end against the
 * current feedback in the DB, writes an iteration_runs row with status =
 * proposed (or failed), and prints a condensed summary. Does NOT commit the
 * proposal to policy_versions — that stays a human decision via the admin UI
 * or POST /api/admin/iterations/:id/apply.
 *
 * Usage: `bun --env-file=.env.local scripts/ops/dry-run-iteration.ts`
 */
import { closeDb } from "@/db/client";
import {
  IterationGuardError,
  runIteration,
} from "@/workers/agent/iterate";

const started = Date.now();
try {
  const result = await runIteration({ requestedBy: "dev-dry-run" });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n=== iteration ${result.status} · ${elapsed}s ===`);
  console.log(`run id: ${result.run.id}`);
  console.log(`base version: v${result.run.baseVersion}`);
  console.log(`feedback count: ${result.run.feedbackCount}`);
  if (result.status === "proposed") {
    console.log(`\n--- reasoningSummary (${result.proposal.reasoningSummary.length} chars) ---`);
    console.log(result.proposal.reasoningSummary);
    console.log(`\n--- changeSummary ---`);
    console.log(result.proposal.changeSummary);
    console.log(`\n--- didNotChange (${result.proposal.didNotChange.length}) ---`);
    for (const entry of result.proposal.didNotChange) {
      console.log(`  - ${entry.item} → ${entry.reason}`);
    }
    console.log(
      `\n--- proposedContent (${result.proposal.proposedContent.length} chars) ---`,
    );
    console.log(result.proposal.proposedContent.slice(0, 400), "...");
  } else {
    console.error(`\n--- agent failed ---`);
    console.error(result.error);
  }
} catch (err) {
  if (err instanceof IterationGuardError) {
    console.error(`\n[GUARD] ${err.code}: ${err.message}`);
  } else {
    console.error(err);
    process.exitCode = 1;
  }
} finally {
  await closeDb();
}
