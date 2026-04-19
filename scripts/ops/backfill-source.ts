#!/usr/bin/env bun
/**
 * Historical backfill runner for a single source (or `--all`).
 *
 * Usage:
 *   bun --env-file=.env.local scripts/ops/backfill-source.ts <sourceId> \
 *     [--from 2026-01-01] [--to 2026-04-18] [--cadence-days 3.5] [--dry-run]
 *
 *   # Backfill every enabled rss/atom source for the same date range:
 *   bun --env-file=.env.local scripts/ops/backfill-source.ts --all \
 *     --from 2026-01-01 --to 2026-04-18
 *
 * The runner writes into `raw_items`; the existing normalize + enrich
 * cron cascade will promote those to `items` on the next tick.
 */
import { eq } from "drizzle-orm";
import { db, closeDb } from "@/db/client";
import { sources } from "@/db/schema";
import type { Source } from "@/db/schema";
import { backfillSource } from "@/lib/backfill/runner";

type Args = {
  all: boolean;
  sourceId: string | null;
  from: Date;
  to: Date;
  cadenceDays: number;
  dryRun: boolean;
  only: Set<string> | null;
  skip: Set<string>;
};

function parseArgs(argv: string[]): Args {
  let all = false;
  let sourceId: string | null = null;
  let from = new Date("2026-01-01T00:00:00Z");
  let to = new Date();
  let cadenceDays = 3.5;
  let dryRun = false;
  let only: Set<string> | null = null;
  let skip = new Set<string>([
    // Useless Wayback targets — frontpage-only RSS has no meaningful history
    "hn-frontpage",
    "reddit-localllama",
    "product-hunt-ai",
  ]);

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") all = true;
    else if (a === "--from") from = new Date(`${argv[++i]}T00:00:00Z`);
    else if (a === "--to") to = new Date(`${argv[++i]}T23:59:59Z`);
    else if (a === "--cadence-days") cadenceDays = Number(argv[++i]);
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--only") only = new Set(argv[++i].split(","));
    else if (a === "--skip") {
      skip = new Set([...skip, ...argv[++i].split(",")]);
    } else if (!a.startsWith("--") && !sourceId) {
      sourceId = a;
    }
  }

  if (!all && !sourceId) {
    console.error("usage: backfill-source <sourceId> | --all [--from ...] [--to ...] [--cadence-days ...] [--dry-run]");
    process.exit(1);
  }
  return { all, sourceId, from, to, cadenceDays, dryRun, only, skip };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const client = db();

  let rows: Source[];
  if (args.all) {
    rows = await client.select().from(sources).where(eq(sources.enabled, true));
    rows = rows.filter(
      (s) =>
        !args.skip.has(s.id) &&
        (args.only ? args.only.has(s.id) : true) &&
        // x-api has its own backfill path (not via Wayback / arxiv)
        s.kind !== "x-api",
    );
  } else {
    rows = await client
      .select()
      .from(sources)
      .where(eq(sources.id, args.sourceId!));
    if (rows.length === 0) {
      console.error(`source not found: ${args.sourceId}`);
      process.exit(1);
    }
  }

  console.log(
    `backfill ${rows.length} source(s) from ${args.from.toISOString().slice(0, 10)} to ${args.to.toISOString().slice(0, 10)}` +
      (args.dryRun ? " (DRY RUN)" : ""),
  );
  console.log(`  cadence=${args.cadenceDays}d   skip=[${[...args.skip].join(",")}]`);

  const summary = {
    sources: 0,
    sampled: 0,
    parsed: 0,
    withinRange: 0,
    inserted: 0,
    errors: 0,
    skipped: 0,
  };

  for (const source of rows) {
    const started = Date.now();
    try {
      const result = await backfillSource(source, {
        from: args.from,
        to: args.to,
        cadenceDays: args.cadenceDays,
        dryRun: args.dryRun,
      });
      const elapsedS = ((Date.now() - started) / 1000).toFixed(1);
      if (result.strategy === "skipped") {
        summary.skipped++;
        console.log(
          `  [skip] ${source.id.padEnd(28)} ${result.reason ?? "no strategy"}`,
        );
        continue;
      }
      summary.sources++;
      summary.sampled += result.sampled;
      summary.parsed += result.parsed;
      summary.withinRange += result.withinRange;
      summary.inserted += result.inserted;
      summary.errors += result.errors;
      console.log(
        `  [${result.strategy.padEnd(7)}] ${source.id.padEnd(28)} ` +
          `sampled=${String(result.sampled).padStart(3)} ` +
          `parsed=${String(result.parsed).padStart(4)} ` +
          `within=${String(result.withinRange).padStart(4)} ` +
          `inserted=${String(result.inserted).padStart(4)} ` +
          `err=${result.errors} ${elapsedS}s`,
      );
    } catch (err) {
      summary.errors++;
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  [fail ] ${source.id.padEnd(28)} ${msg}`);
    }
  }

  console.log(
    `\ndone — sources=${summary.sources} skipped=${summary.skipped} ` +
      `sampled=${summary.sampled} parsed=${summary.parsed} within=${summary.withinRange} ` +
      `inserted=${summary.inserted} errors=${summary.errors}`,
  );

  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
