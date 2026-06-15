#!/usr/bin/env bun
/**
 * Diagnostic — prints the current data state: item counts, enrich progress,
 * month distribution, top sources, shared queue depths, and cron activity.
 *
 * Used to verify backfill runs landed as expected. Safe to run anytime.
 */
import { sql } from "drizzle-orm";
import { db, closeDb } from "@/db/client";
import { getSystemSnapshot } from "@/lib/shell/system-stats";

async function main() {
  const client = db();

  const totals = await client.execute(sql`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE enriched_at IS NOT NULL)::int AS enriched,
      count(*) FILTER (WHERE body_md IS NOT NULL AND body_md != '')::int AS with_body_md,
      count(*) FILTER (WHERE editor_analysis_zh IS NOT NULL AND editor_analysis_zh != '')::int AS with_commentary,
      count(*) FILTER (WHERE tier = 'featured' OR tier = 'p1')::int AS curated
    FROM items
  `);

  const rawState = await client.execute(sql`
    SELECT
      count(*)::int AS raw_total
    FROM raw_items
  `);

  const srcs = await client.execute(sql`
    SELECT count(*) FILTER (WHERE enabled)::int AS enabled,
           count(*) FILTER (WHERE NOT enabled)::int AS disabled
    FROM sources
  `);

  const byMonth = await client.execute(sql`
    SELECT to_char(published_at, 'YYYY-MM') AS month, count(*)::int AS n
    FROM items
    WHERE published_at >= '2025-01-01'::date
    GROUP BY month ORDER BY month DESC
  `);

  const bySource = await client.execute(sql`
    SELECT source_id, count(*)::int AS n
    FROM items
    WHERE published_at >= '2026-01-01'::date AND published_at <= '2026-04-30'::date
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
  console.log("\n=== month distribution (2025-01..now) ===");
  for (const r of byMonth) console.log(`  ${r.month}  ${String(r.n).padStart(5)}`);
  console.log("\n=== top 2026 sources ===");
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
