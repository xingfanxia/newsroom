#!/usr/bin/env bun
/**
 * Diagnostic — prints the current data state: item counts, enrich progress,
 * month distribution, top sources, shared queue depths, and cron activity.
 *
 * Used to verify backfill runs landed as expected. Safe to run anytime.
 */
import { sql } from "drizzle-orm";
import { db, closeDb } from "@/db/client";
import { highlightTierInSql } from "@/lib/items/tier-sql";
import { getSystemSnapshot } from "@/lib/shell/system-stats";

async function main() {
  const client = db();

  const now = new Date();
  // date_trunc('month', now()) - interval '17 months' → first day of the
  // month 17 months ago (UTC) as ms epoch. Date.UTC handles month rollover.
  const monthWindowStartMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth() - 17,
    1,
  );
  // date_trunc('year', now()) and + interval '1 year' → current UTC year bounds.
  const yearStartMs = Date.UTC(now.getUTCFullYear(), 0, 1);
  const nextYearStartMs = Date.UTC(now.getUTCFullYear() + 1, 0, 1);

  const totals = await client.all(sql`
    SELECT
      count(*) AS total,
      count(*) FILTER (WHERE enriched_at IS NOT NULL) AS enriched,
      count(*) FILTER (WHERE body_md IS NOT NULL AND body_md != '') AS with_body_md,
      count(*) FILTER (WHERE editor_note_zh IS NOT NULL AND editor_note_zh != '') AS with_editor_note,
      count(*) FILTER (WHERE editor_analysis_zh IS NOT NULL AND editor_analysis_zh != '') AS with_editor_analysis,
      count(*) FILTER (WHERE ${highlightTierInSql(sql`tier`)}) AS curated
    FROM items
  `);

  const rawState = await client.all(sql`
    SELECT
      count(*) AS raw_total
    FROM raw_items
  `);

  const srcs = await client.all(sql`
    SELECT count(*) FILTER (WHERE enabled) AS enabled,
           count(*) FILTER (WHERE NOT enabled) AS disabled
    FROM sources
  `);

  const byMonth = await client.all<{ month: string; n: number }>(sql`
    SELECT strftime('%Y-%m', published_at / 1000.0, 'unixepoch') AS month,
           count(*) AS n
    FROM items
    WHERE published_at >= ${monthWindowStartMs}
    GROUP BY month ORDER BY month DESC
  `);

  const bySource = await client.all<{ source_id: string; n: number }>(sql`
    SELECT source_id, count(*) AS n
    FROM items
    WHERE published_at >= ${yearStartMs}
      AND published_at < ${nextYearStartMs}
    GROUP BY source_id
    ORDER BY n DESC
    LIMIT 20
  `);

  const system = await getSystemSnapshot();

  console.log("=== totals ===");
  console.log(totals[0]);
  console.log("\n=== raw_items ===");
  console.log(rawState[0]);
  console.log("\n=== sources ===");
  console.log(srcs[0]);
  console.log("\n=== month distribution (last 18 months) ===");
  for (const r of byMonth) console.log(`  ${r.month}  ${String(r.n).padStart(5)}`);
  console.log("\n=== top current-year sources ===");
  for (const r of bySource)
    console.log(`  ${String(r.source_id).padEnd(28)} ${String(r.n).padStart(4)}`);
  console.log("\n=== worker queues ===");
  for (const q of system.queues) {
    console.log(
      `  ${q.name.padEnd(18)} ${String(q.depth).padStart(5)} pending  ${q.rate}`,
    );
  }
  console.log("\n=== cron activity ===");
  for (const c of system.cron) {
    console.log(
      `  ${c.name.padEnd(18)} ${c.schedule.padEnd(17)} last ${c.last.padEnd(10)} next ${c.next}`,
    );
  }

  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
