#!/usr/bin/env bun
/**
 * Install and backfill the trigger-maintained LLM usage rollup.
 *
 * The write batch is one transaction: concurrent llm_usage inserts cannot land
 * between the backfill snapshot and trigger installation. Re-running with
 * --apply rebuilds the rollup from the authoritative raw ledger.
 *
 * Preview: bun --env-file=.env.local scripts/migrations/create-usage-rollups-20260716.ts
 * Apply:   bun --env-file=.env.local scripts/migrations/create-usage-rollups-20260716.ts --apply
 */
import { closeDb, libsqlClient } from "@/db/client";
import {
  CREATE_USAGE_ROLLUP_TABLE_SQL,
  CREATE_USAGE_ROLLUP_TRIGGER_SQL,
  REBUILD_USAGE_ROLLUP_SQL,
} from "@/lib/llm/usage-rollup-sql";

async function main() {
  const apply = process.argv.includes("--apply");
  if (!apply) {
    console.log("DRY RUN: would install the llm_usage daily rollup and backfill it.");
    console.log("Re-run with --apply to commit the idempotent migration.");
    return;
  }

  const client = libsqlClient();
  const startedAt = performance.now();
  await client.batch(
    [
      CREATE_USAGE_ROLLUP_TABLE_SQL,
      "DROP TRIGGER IF EXISTS llm_usage_daily_rollup_ai",
      CREATE_USAGE_ROLLUP_TRIGGER_SQL,
      "DELETE FROM llm_usage_daily_rollups",
      REBUILD_USAGE_ROLLUP_SQL,
    ],
    "write",
  );

  const [raw, rollup] = await client.batch(
    [
      `SELECT count(*) AS calls
       FROM llm_usage INDEXED BY llm_usage_totals_cover_idx`,
      `SELECT coalesce(sum(calls), 0) AS calls,
              count(*) AS rollup_rows,
              count(DISTINCT day_idx) AS days
       FROM llm_usage_daily_rollups`,
    ],
    "read",
  );
  const rawCalls = Number(raw.rows[0]?.calls ?? 0);
  const rolledCalls = Number(rollup.rows[0]?.calls ?? 0);
  if (rawCalls !== rolledCalls) {
    throw new Error(
      `usage rollup validation failed: raw=${rawCalls}, rollup=${rolledCalls}`,
    );
  }
  console.log(
    JSON.stringify({
      ok: true,
      calls: rawCalls,
      rollupRows: Number(rollup.rows[0]?.rollup_rows ?? 0),
      days: Number(rollup.rows[0]?.days ?? 0),
      elapsedMs: Math.round(performance.now() - startedAt),
    }),
  );
}

try {
  await main();
} finally {
  await closeDb();
}
