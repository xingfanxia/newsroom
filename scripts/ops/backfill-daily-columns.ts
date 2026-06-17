#!/usr/bin/env bun
/**
 * Regenerate existing daily columns with the current friend-sharing prompt.
 *
 * It only targets dates that already have a daily column row, so the script
 * rewrites historical prose without inventing new publication dates.
 */
import pLimit from "p-limit";
import { and, desc, gte, lte, sql } from "drizzle-orm";
import { closeDb, db } from "@/db/client";
import { newsletters } from "@/db/schema";
import { DAILY_NEWSLETTER_KIND, type NewsletterLocale } from "@/lib/types";
import { runDailyColumn } from "@/workers/newsletter/run-daily-column";
import { runTimeForDailyPeriodStart } from "@/workers/newsletter/windows";
import {
  loadOpsState,
  opsStatePath,
  saveOpsState,
} from "@/scripts/ops/state";

const DAILY_COLUMN_LOCALE = "zh" satisfies NewsletterLocale;

const STATE_FILE = opsStatePath("backfill-daily-columns-state.json");

type Flags = {
  dryRun: boolean;
  resume: boolean;
  batchSize: number;
  limit: number | null;
  since: string | null;
  until: string | null;
};

type State = {
  donePeriods: string[];
  updatedAt: string;
};

function usage(): void {
  console.log(`backfill-daily-columns.ts — regenerate existing daily columns

Flags:
  --dry-run                 print target dates, no LLM calls (default)
  --apply                   regenerate and upsert rows
  --resume                  skip period_start values in scripts/ops/backfill-daily-columns-state.json
  --batch-size <N>          concurrency cap (default 1)
  --limit <N>               only run first N target dates
  --since <YYYY-MM-DD>      include rows with period_start >= dateT05:00Z
  --until <YYYY-MM-DD>      include rows with period_start <= dateT05:00Z
`);
}

function parseArgs(argv: string[]): Flags {
  const flags: Flags = {
    dryRun: true,
    resume: false,
    batchSize: 1,
    limit: null,
    since: null,
    until: null,
  };
  const next = (i: number, name: string): string => {
    const v = argv[i];
    if (!v) throw new Error(`${name} requires a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      usage();
      process.exit(0);
    } else if (a === "--dry-run") flags.dryRun = true;
    else if (a === "--apply") flags.dryRun = false;
    else if (a === "--resume") flags.resume = true;
    else if (a === "--batch-size") {
      flags.batchSize = Number.parseInt(next(++i, a), 10);
    } else if (a === "--limit") {
      flags.limit = Number.parseInt(next(++i, a), 10);
    } else if (a === "--since") {
      flags.since = next(++i, a);
    } else if (a === "--until") {
      flags.until = next(++i, a);
    } else {
      throw new Error(`unknown flag: ${a}`);
    }
  }
  if (!Number.isInteger(flags.batchSize) || flags.batchSize < 1) {
    throw new Error("--batch-size must be an integer >= 1");
  }
  if (flags.limit != null && (!Number.isInteger(flags.limit) || flags.limit < 1)) {
    throw new Error("--limit must be an integer >= 1");
  }
  for (const [name, value] of [["--since", flags.since], ["--until", flags.until]] as const) {
    if (value != null && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new Error(`${name} must be YYYY-MM-DD`);
    }
  }
  return flags;
}

async function loadState(resume: boolean): Promise<State> {
  return loadOpsState<State>({
    resume,
    file: STATE_FILE,
    empty: emptyDailyColumnBackfillState,
    normalize: normalizeDailyColumnBackfillState,
  });
}

async function saveState(state: State): Promise<void> {
  await saveOpsState(STATE_FILE, state);
}

function emptyDailyColumnBackfillState(): State {
  return { donePeriods: [], updatedAt: new Date().toISOString() };
}

function normalizeDailyColumnBackfillState(
  parsed: Partial<State>,
  empty: State,
): State {
  return {
    donePeriods: parsed.donePeriods ?? [],
    updatedAt: parsed.updatedAt ?? empty.updatedAt,
  };
}

function startOfUtcDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function endOfUtcDate(date: string): Date {
  return new Date(`${date}T23:59:59.999Z`);
}

async function loadExistingDailyPeriods(flags: Flags): Promise<string[]> {
  const filters = [
    sql`${newsletters.kind} = ${DAILY_NEWSLETTER_KIND}`,
    sql`${newsletters.locale} = ${DAILY_COLUMN_LOCALE}`,
    sql`${newsletters.columnTitle} IS NOT NULL`,
  ];
  if (flags.since) filters.push(gte(newsletters.periodStart, startOfUtcDate(flags.since)));
  if (flags.until) filters.push(lte(newsletters.periodStart, endOfUtcDate(flags.until)));

  const rows = await db()
    .select({ periodStart: newsletters.periodStart })
    .from(newsletters)
    .where(and(...filters))
    .orderBy(desc(newsletters.periodStart));

  return rows.map((r) => r.periodStart.toISOString());
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));
  const state = await loadState(flags.resume);
  const done = new Set(state.donePeriods);
  const allPeriods = await loadExistingDailyPeriods(flags);
  const targetPeriods = allPeriods.filter((period) => !done.has(period));
  const selected = flags.limit == null ? targetPeriods : targetPeriods.slice(0, flags.limit);

  console.log(
    `mode=${flags.dryRun ? "DRY-RUN" : "APPLY"} batch=${flags.batchSize} resume=${flags.resume} targets=${targetPeriods.length} running=${selected.length}`,
  );
  if (selected.length > 0) {
    console.log(`period_starts=${selected.join(",")}`);
  }

  if (flags.dryRun) {
    console.log("dry-run: no LLM calls and no DB writes. Re-run with --apply to regenerate.");
    return;
  }

  const limit = pLimit(flags.batchSize);
  let doneCount = 0;
  let errors = 0;
  await Promise.allSettled(
    selected.map((date, idx) =>
      limit(async () => {
        try {
          const report = await runDailyColumn({
            now: runTimeForDailyPeriodStart(date),
            force: true,
          });
          state.donePeriods.push(date);
          doneCount++;
          await saveState(state);
          console.log(
            `[daily] ${doneCount}/${selected.length} period_start=${date} id=${report.generated?.newsletterId ?? "skipped"} story_count=${report.storyCount} qcHits=${report.qcHits} ${report.durationMs}ms`,
          );
        } catch (err) {
          errors++;
          console.error(
            `[daily] error at row ${idx} period_start=${date}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }),
    ),
  );

  await saveState(state);
  console.log(`summary done=${doneCount} errors=${errors}`);
  console.log(`state_file=${STATE_FILE}`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
