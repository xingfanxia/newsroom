#!/usr/bin/env bun
/**
 * X/Twitter historical backfill — paginates /2/users/:id/tweets inside a
 * time window and inserts into raw_items.
 *
 * COST WARNING: X API v2 bills per tweet returned. This script runs against
 * every enabled x-api source in the DB by default. Always dry-run first.
 *
 * Usage:
 *   bun --env-file=.env.local scripts/ops/backfill-x.ts \
 *     --from 2026-04-01 --to 2026-04-18 --dry-run
 *
 *   bun --env-file=.env.local scripts/ops/backfill-x.ts \
 *     --from 2026-04-01 --to 2026-04-18 --only x-dotey,x-anthropic
 *
 * The runner honours source_health.lastExternalId semantics from the
 * hourly cron — historical tweets inserted here will also appear in
 * subsequent `/api/cron/*` ticks. Dedup on (source_id, external_id)
 * keeps the pipeline idempotent.
 */
import { eq } from "drizzle-orm";
import { db, closeDb } from "@/db/client";
import { sources } from "@/db/schema";
import { fetchHistoricalForHandle, handleFromUrl } from "@/workers/fetcher/x-api";
import { insertRawItems } from "@/lib/backfill/runner";

type Args = {
  from: Date;
  to: Date;
  dryRun: boolean;
  only: Set<string> | null;
  maxTweets: number;
};

function parseArgs(argv: string[]): Args {
  let from: Date | null = null;
  let to: Date | null = null;
  let dryRun = false;
  let only: Set<string> | null = null;
  let maxTweets = 500;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--from") from = new Date(`${argv[++i]}T00:00:00Z`);
    else if (a === "--to") to = new Date(`${argv[++i]}T23:59:59Z`);
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--only") only = new Set(argv[++i].split(","));
    else if (a === "--max-tweets") maxTweets = Number(argv[++i]);
  }
  if (!from || !to) {
    console.error("usage: backfill-x --from YYYY-MM-DD --to YYYY-MM-DD [--only id,id] [--max-tweets N] [--dry-run]");
    process.exit(1);
  }
  return { from, to, dryRun, only, maxTweets };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const client = db();
  const rows = await client
    .select()
    .from(sources)
    .where(eq(sources.enabled, true));

  const xSources = rows.filter(
    (s) => s.kind === "x-api" && (args.only ? args.only.has(s.id) : true),
  );
  if (xSources.length === 0) {
    console.error("no enabled x-api sources match filter");
    process.exit(1);
  }

  console.log(
    `x-api backfill: ${xSources.length} handle(s) from ${args.from.toISOString()} to ${args.to.toISOString()}` +
      (args.dryRun ? " (DRY RUN)" : ""),
  );
  console.log(`  maxTweets per handle = ${args.maxTweets}`);

  let totalFetched = 0;
  let totalInserted = 0;
  let totalPages = 0;

  for (const src of xSources) {
    const started = Date.now();
    const handle = handleFromUrl(src.url);
    try {
      const { items, pages } = await fetchHistoricalForHandle({
        handle,
        startTime: args.from,
        endTime: args.to,
        maxTweets: args.maxTweets,
      });
      totalFetched += items.length;
      totalPages += pages;

      let inserted = 0;
      if (!args.dryRun && items.length > 0) {
        inserted = await insertRawItems(src.id, items);
      }
      totalInserted += inserted;

      const elapsedS = ((Date.now() - started) / 1000).toFixed(1);
      console.log(
        `  ${src.id.padEnd(14)} @${handle.padEnd(16)} pages=${pages} tweets=${String(items.length).padStart(4)} inserted=${String(inserted).padStart(4)} ${elapsedS}s`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ${src.id.padEnd(14)} ERROR — ${msg}`);
    }
  }

  console.log(
    `\ndone — handles=${xSources.length} pages=${totalPages} tweets_fetched=${totalFetched} inserted=${totalInserted}`,
  );
  console.log(
    `  billed_read_count ≈ ${totalFetched} (one bill per tweet returned from the API)`,
  );

  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
