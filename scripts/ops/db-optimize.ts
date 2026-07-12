/**
 * Query-planner maintenance for the live Turso DB. Idempotent; rerun any
 * time (e.g. after adding a feed-path query or index).
 *
 * 1. Ensures the non-vector perf indexes exist. These are plain b-trees
 *    (seconds to build at this table size) — NOT vector indexes, which must
 *    never be bulk-created on Turso (see scripts/ops/db-create-vector-index.ts).
 *    Created here with raw SQL because `drizzle-kit push` is unsafe against
 *    the live DB: it would try to drop the out-of-band DiskANN index.
 * 2. Verifies the hot feed-path queries plan onto their pinned indexes.
 *
 * Why pinning (INDEXED BY) instead of trusting the planner: Turso's sqld
 * REJECTS `ANALYZE` ("SQL not allowed statement"), so sqlite_stat1 can never
 * exist and the planner runs on default guesses forever. That's how the home
 * feed ended up on a scan plan that fetched every enriched row from the
 * payload-heavy table pages (~10s cold) instead of using the covering index
 * (~40ms) — 2026-07-12 incident. Every latency-sensitive query over `items`
 * must therefore pin its index explicitly.
 *
 * Run: bun scripts/ops/db-optimize.ts
 */
import { closeDb, libsqlClient } from "@/db/client";

const INDEXES = [
  `CREATE INDEX IF NOT EXISTS items_created_tier_idx
     ON items (created_at, tier)`,
  `CREATE INDEX IF NOT EXISTS items_topics_cover_idx
     ON items (created_at, tags)
     WHERE enriched_at IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS clusters_feed_cover_idx
     ON clusters (id, event_tier, lead_item_id, first_seen_at,
                  latest_member_at, importance)`,
];

/** Hot query shapes and the index each one's plan must reference. */
const PLAN_CHECKS: Array<{ name: string; index: string; sql: string }> = [
  {
    name: "feed id-subquery (getFeaturedStories)",
    index: "items_feed_cover_idx",
    sql: `SELECT id FROM items
          WHERE id IN (
            SELECT items.id FROM items INDEXED BY items_feed_cover_idx
            INNER JOIN sources ON items.source_id = sources.id
            LEFT JOIN clusters INDEXED BY clusters_feed_cover_idx
              ON items.cluster_id = clusters.id
            WHERE items.enriched_at IS NOT NULL
              AND items.importance IS NOT NULL
            ORDER BY +items.published_at DESC LIMIT 120)`,
  },
  {
    name: "feed cluster probe stays covering",
    index: "COVERING INDEX clusters_feed_cover_idx",
    sql: `SELECT count(*) FROM items INDEXED BY items_feed_cover_idx
          LEFT JOIN clusters INDEXED BY clusters_feed_cover_idx
            ON items.cluster_id = clusters.id
          WHERE items.enriched_at IS NOT NULL
            AND COALESCE(clusters.event_tier, items.tier) <> 'excluded'`,
  },
  {
    name: "radar stats 24h counts (getRadarStats)",
    index: "items_created_tier_idx",
    sql: `SELECT count(*) FROM items WHERE created_at >= 0`,
  },
  {
    name: "top topics 7d tag scan (getTopTopics)",
    index: "items_topics_cover_idx",
    sql: `SELECT tags FROM items INDEXED BY items_topics_cover_idx
          WHERE created_at >= 0 AND enriched_at IS NOT NULL`,
  },
];

async function main() {
  const client = libsqlClient();

  for (const ddl of INDEXES) {
    const t0 = performance.now();
    await client.execute(ddl);
    const name = ddl.match(/EXISTS (\S+)/)?.[1];
    console.log(`${name}: ok (${(performance.now() - t0).toFixed(0)}ms)`);
  }

  let failed = 0;
  for (const check of PLAN_CHECKS) {
    const plan = await client.execute(`EXPLAIN QUERY PLAN ${check.sql}`);
    const details = plan.rows.map((r) => String(r.detail)).join(" | ");
    const ok = details.includes(check.index);
    if (!ok) failed += 1;
    console.log(`${ok ? "PASS" : "FAIL"} ${check.name}`);
    if (!ok) console.log(`  plan: ${details}`);
  }

  await closeDb();
  if (failed > 0) {
    console.error(`${failed} plan check(s) FAILED`);
    process.exit(1);
  }
  console.log("DB OPTIMIZE DONE");
}

main().catch((e) => {
  console.error("failed:", e);
  process.exit(1);
});
