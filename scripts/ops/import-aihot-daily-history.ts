#!/usr/bin/env bun
/**
 * One-shot ingest of AI HOT historical daily reports into our newsletters
 * table. Pulls from /api/public/dailies (index) + /api/public/daily/<date>
 * (full payload), upserts into the same daily-column newsletter kind/locale
 * rows keyed by aihot_daily_date.
 *
 * Existing daily-column rows already authored by our pipeline are preserved —
 * this script only fills in the AI HOT payload columns (aihot_daily_payload +
 * aihot_daily_date). When no daily row exists for a date, we create a placeholder
 * with column_* fields all NULL so the daily-column writer can later fill them
 * on its own cadence.
 *
 * Usage:
 *   bun scripts/ops/import-aihot-daily-history.ts --dry-run
 *   bun scripts/ops/import-aihot-daily-history.ts --days 180
 *   bun scripts/ops/import-aihot-daily-history.ts --days 30 --force
 */
import { and, eq, sql } from "drizzle-orm";
import { db, closeDb } from "@/db/client";
import { newsletters } from "@/db/schema";
import { DAILY_COLUMN_LOCALE, DAILY_NEWSLETTER_KIND } from "@/lib/types";
import {
  AihotError,
  fetchDailiesIndex,
  fetchDailyByDate,
  type AihotDailyReport,
} from "@/lib/sources/aihot";

const PAGE_DELAY_MS = 80;

interface CliFlags {
  days: number;
  dryRun: boolean;
  force: boolean;
}

function parseArgs(argv: string[]): CliFlags {
  const flags: CliFlags = { days: 180, dryRun: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      printUsage();
      process.exit(0);
    } else if (a === "--dry-run") flags.dryRun = true;
    else if (a === "--force") flags.force = true;
    else if (a === "--days") {
      const v = argv[++i];
      if (!v) die("--days requires a value");
      const n = Number.parseInt(v, 10);
      if (!Number.isInteger(n) || n < 1 || n > 180) {
        die(`--days must be 1..180, got ${v}`);
      }
      flags.days = n;
    } else die(`unknown flag: ${a}`);
  }
  return flags;
}

function die(msg: string): never {
  console.error(`error: ${msg}\n`);
  printUsage();
  process.exit(2);
}

function printUsage(): void {
  console.log(`import-aihot-daily-history.ts — ingest AI HOT historical dailies

Flags:
  --days <N>      Number of days back to pull (default 180, AI HOT max).
  --dry-run       Print what would be imported, no DB writes.
  --force         Overwrite aihot_daily_payload even if already populated.
  --help / -h     This message.`);
}

function periodForDate(date: string): { start: Date; end: Date } {
  // YYYY-MM-DD interpreted as UTC midnight; bucket is 24h wide.
  const start = new Date(`${date}T00:00:00Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

function payloadStats(report: AihotDailyReport): {
  sectionsCount: number;
  flashesCount: number;
  approxKb: number;
} {
  const json = JSON.stringify(report);
  return {
    sectionsCount: report.sections?.length ?? 0,
    flashesCount: report.flashes?.length ?? 0,
    approxKb: Math.round((json.length / 1024) * 10) / 10,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));
  console.log(
    `pulling ${flags.days} day(s) of AI HOT history (dry_run=${flags.dryRun} force=${flags.force})`,
  );

  // Fetch the index of available dailies.
  let index;
  try {
    index = await fetchDailiesIndex(flags.days);
  } catch (err) {
    if (err instanceof AihotError) {
      console.error(`dailies index fetch failed: ${err.code} — ${err.message}`);
    } else {
      console.error(
        `dailies index fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    process.exit(1);
  }

  console.log(`AI HOT advertised ${index.count} daily report(s) in window`);
  if (index.items.length === 0) {
    console.log("nothing to import — exit 0");
    await closeDb();
    return;
  }

  const client = db();
  let imported = 0;
  let skipped = 0;
  let placeholders = 0;
  let errors = 0;
  const total = index.items.length;

  for (let i = 0; i < total; i++) {
    const entry = index.items[i];
    const date = entry.date;
    const tag = `[${i + 1}/${total}] ${date}`;

    // Check existing row + preserve column_* fields written by our daily writer.
    const [existing] = await client
      .select({
        id: newsletters.id,
        aihotDailyPayload: newsletters.aihotDailyPayload,
        columnTitle: newsletters.columnTitle,
      })
      .from(newsletters)
      .where(
        and(
          eq(newsletters.kind, DAILY_NEWSLETTER_KIND),
          eq(newsletters.locale, DAILY_COLUMN_LOCALE),
          eq(newsletters.aihotDailyDate, date),
        ),
      )
      .limit(1);

    if (existing && existing.aihotDailyPayload && !flags.force) {
      console.log(`${tag} — already populated, skip (use --force to overwrite)`);
      skipped++;
      continue;
    }

    let report: AihotDailyReport | null;
    try {
      report = await fetchDailyByDate(date);
    } catch (err) {
      errors++;
      const msg =
        err instanceof AihotError
          ? `${err.code} ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      console.error(`${tag} — fetch failed: ${msg}`);
      await sleep(PAGE_DELAY_MS);
      continue;
    }

    if (!report) {
      console.warn(`${tag} — AI HOT 404 (advertised but missing)`);
      await sleep(PAGE_DELAY_MS);
      continue;
    }

    const stats = payloadStats(report);
    const detail = `payload ${stats.approxKb}kb, sections=${stats.sectionsCount}, flashes=${stats.flashesCount}`;

    if (flags.dryRun) {
      console.log(`${tag} — ${detail} (dry-run)`);
      imported++;
      await sleep(PAGE_DELAY_MS);
      continue;
    }

    const { start, end } = periodForDate(date);
    if (existing) {
      // Preserve any column_* fields already written by the daily-column writer.
      await client
        .update(newsletters)
        .set({
          aihotDailyPayload: report,
          aihotDailyDate: date,
        })
        .where(eq(newsletters.id, existing.id));
      console.log(
        `${tag} — ${detail}${existing.columnTitle ? " (preserved column_*)" : ""}`,
      );
    } else {
      // Placeholder row: column_* NULL, daily-column writer fills later.
      // Insert via raw SQL since `kind`/`locale` in newsletters are plain text
      // columns but we still want the unique (kind, locale, period_start) index
      // to dedupe if a row sneaks in concurrently.
      await client
        .insert(newsletters)
        .values({
          kind: DAILY_NEWSLETTER_KIND,
          locale: DAILY_COLUMN_LOCALE,
          periodStart: start,
          periodEnd: end,
          storyCount: 0,
          aihotDailyPayload: report,
          aihotDailyDate: date,
        })
        .onConflictDoNothing({
          target: [
            newsletters.kind,
            newsletters.locale,
            newsletters.periodStart,
          ],
        });
      placeholders++;
      console.log(`${tag} — ${detail} (placeholder created)`);
    }

    imported++;
    await sleep(PAGE_DELAY_MS);
  }

  console.log(`\n── Summary ──`);
  console.log(`  dates seen:        ${total}`);
  console.log(`  imported:          ${imported}${flags.dryRun ? " (dry-run)" : ""}`);
  console.log(`  placeholders new:  ${placeholders}`);
  console.log(`  skipped (had):     ${skipped}`);
  console.log(`  errors:            ${errors}`);
  console.log(`  throttle:          ${PAGE_DELAY_MS}ms between calls`);

  // Sanity check: count newsletters rows with payload now (skip in dry-run).
  if (!flags.dryRun) {
    const [withPayload] = await client
      .select({ n: sql<number>`count(*)::int` })
      .from(newsletters)
      .where(
        and(
          eq(newsletters.kind, DAILY_NEWSLETTER_KIND),
          eq(newsletters.locale, DAILY_COLUMN_LOCALE),
          sql`${newsletters.aihotDailyPayload} IS NOT NULL`,
        ),
      );
    console.log(
      `  newsletters with aihot payload (kind=${DAILY_NEWSLETTER_KIND}, locale=${DAILY_COLUMN_LOCALE}): ${withPayload?.n ?? 0}`,
    );
  }

  await closeDb();
}

main().catch(async (err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("import-aihot-daily-history failed:", msg);
  await closeDb().catch(() => {});
  process.exit(1);
});
