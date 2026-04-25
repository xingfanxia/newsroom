/**
 * Regenerate the daily column for a given date (YYYY-MM-DD).
 * Computes the cron-firing time as `<date>T05:00:00Z` (the standard 9pm PT slot)
 * and re-runs the writer with force=true.
 *
 * Usage:
 *   bun --env-file=.env.local run scripts/ops/regen-daily-column.ts 2026-04-25
 */
import { runDailyColumn } from "@/workers/newsletter/run-daily-column";

const date = process.argv[2];
if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error("usage: regen-daily-column.ts YYYY-MM-DD");
  process.exit(1);
}

const cronFireTime = new Date(`${date}T05:00:00Z`);
console.log(
  `regenerating column for window ending ${cronFireTime.toISOString()} ...`,
);
const report = await runDailyColumn({ now: cronFireTime, force: true });
console.log(JSON.stringify(report, null, 2));
