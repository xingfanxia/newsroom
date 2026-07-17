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
  // Recency-bounded twin of items_feed_cover_idx (W8). published_at LEADS so
  // the public feed views' `published_at >= <floor>` predicate seeks the recent
  // window (a few hundred rows) instead of scanning all ~21.6k enriched rows —
  // items_feed_cover_idx has published_at last, so a floor there filters but
  // can't seek. Trailing columns mirror the cover index so the bounded scan
  // stays inside the index (no fat-row lookups). getFeaturedStories pins this
  // whenever a published_at lower bound (recencyFloorDays or explicit date) is
  // set. Plain b-tree — safe to create on Turso (NOT a vector index).
  `CREATE INDEX IF NOT EXISTS items_feed_recent_idx
     ON items (published_at, enriched_at, importance, tier,
               cluster_id, source_id)`,
  // Partial index for the arbitrate + canonical-title candidate scans (W7/A3).
  // Both select `member_count >= 2 AND <needs-work>` ORDER BY member_count DESC,
  // updated_at DESC. Holding only the ~1.1K multi-member clusters in that sort
  // order turns the every-tick full scan of ~16K clusters into a bounded index
  // scan. Partial-index selection is structural (not stats-based), so the
  // planner picks it even without ANALYZE — see the two PLAN_CHECKS below.
  `CREATE INDEX IF NOT EXISTS clusters_multimember_idx
     ON clusters (member_count, updated_at)
     WHERE member_count >= 2`,
  // Absolute (item, cluster) negative-edge constraint for Stage B rejections.
  // REQUIRES the 2026-07-12 dedupe migration to have run first — creating this
  // over duplicate pairs throws "UNIQUE constraint failed". See
  // scripts/migrations/repair-cluster-drift-20260712.ts.
  `CREATE UNIQUE INDEX IF NOT EXISTS cluster_splits_item_cluster_uq
     ON cluster_splits (item_id, from_cluster_id)`,
  // Covering index for the admin usage "all"-window task breakdown (unbounded
  // GROUP BY task,provider,model over 364k rows). Leading group keys + summed
  // columns so the scan stays inside the index (no fat-row lookups). T7.
  `CREATE INDEX IF NOT EXISTS llm_usage_breakdown_cover_idx
     ON llm_usage (task, provider, model, cost_usd, input_tokens, output_tokens)`,
  // Covering index for the "all"-window model breakdown (GROUP BY
  // provider,model). Separate leading prefix from the task index above. T7.
  `CREATE INDEX IF NOT EXISTS llm_usage_model_cover_idx
     ON llm_usage (provider, model, cost_usd)`,
  // Covering index for totalsByWindow (the usage page's headline sums). created_at
  // leads so bounded windows still prune; 'all' stays inside the index with no
  // fat-row lookups. 2026-07-12 review finding 2c.
  `CREATE INDEX IF NOT EXISTS llm_usage_totals_cover_idx
     ON llm_usage (created_at, input_tokens, cached_input_tokens,
                   output_tokens, reasoning_tokens, cost_usd)`,
  // Partial index for the commentary-backfill candidate scan (W9b-idx). The
  // worker filters `tier IN (visible) AND commentary_at IS NULL`; without this
  // it seeks items_tier_idx and reads every visible-tier row (~8.9K measured) to
  // find the ~27 still lacking commentary, twice a day (~1M rows_read/mo). Only
  // commentary-pending rows live here, tier-leading, so the visible-tier seek
  // touches just those. Partial selection is structural (Turso forbids ANALYZE),
  // like clusters_multimember_idx — verified by the UNPINNED plan check below.
  `CREATE INDEX IF NOT EXISTS items_commentary_pending_idx
     ON items (tier, cluster_id)
     WHERE commentary_at IS NULL`,
  // /admin/system activity probes and queue counts. These indexes keep exact
  // operational metrics off raw_items/items payload pages.
  `CREATE INDEX IF NOT EXISTS raw_items_normalized_activity_idx
     ON raw_items (normalized_at)
     WHERE normalized_at IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS items_body_prefetch_pending_idx
     ON items (body_fetched_at, canonical_url)
     WHERE body_fetched_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS items_body_activity_idx
     ON items (body_fetched_at)
     WHERE body_fetched_at IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS items_commentary_activity_idx
     ON items (commentary_at)
     WHERE commentary_at IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS items_score_backfill_pending_idx
     ON items (id)
     WHERE enriched_at IS NOT NULL
       AND (hkr IS NULL
            OR reasoning_zh IS NULL
            OR reasoning_en IS NULL
            OR json_extract(hkr, '$.reasonsZh') IS NULL
            OR json_extract(hkr, '$.reasonsEn') IS NULL)`,
  `CREATE INDEX IF NOT EXISTS clusters_event_commentary_pending_idx
     ON clusters (event_tier, latest_member_at, first_seen_at)
     WHERE member_count >= 2 AND commentary_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS clusters_updated_activity_idx
     ON clusters (updated_at)`,
];

/** Hot query shapes and the index each one's plan must reference. */
const PLAN_CHECKS: Array<{ name: string; index: string; sql: string }> = [
  {
    name: "admin normalize activity stays covering",
    index: "raw_items_normalized_activity_idx",
    sql: `SELECT normalized_at FROM raw_items
          INDEXED BY raw_items_normalized_activity_idx
          WHERE normalized_at IS NOT NULL
          ORDER BY normalized_at DESC LIMIT 1`,
  },
  {
    name: "admin body-prefetch depth stays covering",
    index: "items_body_prefetch_pending_idx",
    sql: `SELECT count(*) FROM items
          INDEXED BY items_body_prefetch_pending_idx
          WHERE body_fetched_at IS NULL
            AND canonical_url IS NOT NULL
            AND NOT (canonical_url LIKE '%x.com/%/status/%'
                     OR canonical_url LIKE '%twitter.com/%/status/%')`,
  },
  {
    name: "admin body activity stays covering",
    index: "items_body_activity_idx",
    sql: `SELECT body_fetched_at FROM items
          INDEXED BY items_body_activity_idx
          WHERE body_fetched_at IS NOT NULL
          ORDER BY body_fetched_at DESC LIMIT 1`,
  },
  {
    name: "admin commentary activity stays covering",
    index: "items_commentary_activity_idx",
    sql: `SELECT commentary_at FROM items
          INDEXED BY items_commentary_activity_idx
          WHERE commentary_at IS NOT NULL
          ORDER BY commentary_at DESC LIMIT 1`,
  },
  {
    name: "admin score queue uses its partial index",
    index: "items_score_backfill_pending_idx",
    sql: `SELECT count(*) FROM items
          INDEXED BY items_score_backfill_pending_idx
          WHERE enriched_at IS NOT NULL
            AND (hkr IS NULL
                 OR reasoning_zh IS NULL
                 OR reasoning_en IS NULL
                 OR json_extract(hkr, '$.reasonsZh') IS NULL
                 OR json_extract(hkr, '$.reasonsEn') IS NULL)`,
  },
  {
    name: "admin event-commentary depth stays covering",
    index: "clusters_event_commentary_pending_idx",
    sql: `SELECT count(*) FROM clusters
          INDEXED BY clusters_event_commentary_pending_idx
          WHERE event_tier IN ('featured', 'p1', 'all')
            AND member_count >= 2 AND commentary_at IS NULL
            AND COALESCE(latest_member_at, first_seen_at) >= 0`,
  },
  {
    name: "admin cluster activity stays covering",
    index: "clusters_updated_activity_idx",
    sql: `SELECT updated_at FROM clusters
          INDEXED BY clusters_updated_activity_idx
          ORDER BY updated_at DESC LIMIT 1`,
  },
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
    // W8 — recency-bounded feed scan must SEEK items_feed_recent_idx on the
    // published_at floor, not scan items_feed_cover_idx. A faithful mirror of
    // getFeaturedStories' id-subquery when recencyFloorDays/date is set. The
    // index is pinned via INDEXED BY, so asserting the bare name only proves it
    // EXISTS — a full `SCAN … USING INDEX items_feed_recent_idx` contains the
    // name too. We assert the `(published_at>?)` seek shape so a column-order
    // regression (published_at no longer leading) degrades the plan to a scan
    // and trips this check. `published_at >= 0` keeps the range predicate (Turso
    // forbids ANALYZE, so it can't fold to always-true), yielding that shape.
    name: "recency-bounded feed subquery seeks items_feed_recent_idx (W8)",
    index: "items_feed_recent_idx (published_at>?)",
    sql: `SELECT id FROM items
          WHERE id IN (
            SELECT items.id FROM items INDEXED BY items_feed_recent_idx
            INNER JOIN sources ON items.source_id = sources.id
            LEFT JOIN clusters INDEXED BY clusters_feed_cover_idx
              ON items.cluster_id = clusters.id
            WHERE items.published_at >= 0
              AND items.enriched_at IS NOT NULL
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
    // W7/A3 — arbitrate candidate scan. UNPINNED on purpose: this verifies the
    // planner structurally selects the partial index (no INDEXED BY), which is
    // how the drizzle query in runArbitrationBatch benefits. Keep this SQL a
    // faithful mirror of that builder (workers/cluster/arbitrate.ts — same
    // WHERE/ORDER BY/LIMIT) so the guard tracks the real query, not a stale
    // proxy. LIMIT = MAX_ARBITRATIONS_PER_RUN (15).
    name: "arbitrate candidate scan uses partial multimember index (W7/A3)",
    index: "clusters_multimember_idx",
    sql: `SELECT c.id, c.lead_item_id, c.member_count FROM clusters c
          WHERE c.member_count >= 2
            AND (c.verified_at IS NULL OR EXISTS (
              SELECT 1 FROM items i
              WHERE i.cluster_id = c.id AND i.cluster_verified_at IS NULL))
          ORDER BY c.member_count DESC, c.updated_at DESC LIMIT 15`,
  },
  {
    // Mirror of the canonical-title builder (workers/cluster/canonical-title.ts):
    // the WHERE includes the `canonical_title_zh IS NULL` branch and LIMIT =
    // MAX_TITLES_PER_RUN (15). The extra OR term is a residual filter on a
    // non-indexed column, so it does not change index selection, but the guard
    // must carry it to stay a faithful mirror.
    name: "canonical-title candidate scan uses partial multimember index (W7/A3)",
    index: "clusters_multimember_idx",
    sql: `SELECT c.id, c.member_count FROM clusters c
          WHERE c.member_count >= 2
            AND (c.canonical_title_zh IS NULL
                 OR c.titled_at IS NULL
                 OR c.updated_at > c.titled_at)
          ORDER BY c.member_count DESC, c.updated_at DESC LIMIT 15`,
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
  {
    // W9b-idx — commentary-backfill candidate scan. UNPINNED on purpose (like the
    // multimember checks): verifies the planner STRUCTURALLY selects the partial
    // index — the drizzle query in runCommentaryBackfill has no INDEXED BY, so its
    // read savings depend on the planner picking items_commentary_pending_idx over
    // items_tier_idx. Faithful mirror of that builder (workers/enrich/commentary.ts:
    // same tier IN / commentary_at IS NULL / cluster OR / LIMIT 200). If this FAILs,
    // the query still scans ~8.9K visible-tier rows — pin it via INDEXED BY.
    // Assert the `(tier=?)` SEEK shape, not bare presence (W8 precedent): a
    // column-order regression (e.g. swap to (cluster_id, tier)) would degrade the
    // seek to a full partial-index scan while a bare-name check kept passing.
    name: "commentary candidate scan uses partial commentary-pending index (W9b-idx)",
    index: "items_commentary_pending_idx (tier=?)",
    sql: `SELECT i.* FROM items i
          LEFT JOIN clusters c ON i.cluster_id = c.id
          WHERE i.tier IN ('featured', 'p1', 'all')
            AND i.commentary_at IS NULL
            AND (i.cluster_id IS NULL OR COALESCE(c.member_count, 1) < 2)
          LIMIT 200`,
  },
  {
    name: "usage daily-spend bounded scan (dailySpend)",
    index: "llm_usage_created_at_idx",
    sql: `SELECT created_at / 86400000 AS day_idx, sum(cost_usd), count(id)
          FROM llm_usage INDEXED BY llm_usage_created_at_idx
          WHERE created_at >= 0 GROUP BY day_idx`,
  },
  {
    name: "usage all-window task breakdown covering (breakdownByTask)",
    index: "llm_usage_breakdown_cover_idx",
    sql: `SELECT task, provider, model, count(*),
                 sum(input_tokens), sum(output_tokens), sum(cost_usd)
          FROM llm_usage INDEXED BY llm_usage_breakdown_cover_idx
          GROUP BY task, provider, model`,
  },
  {
    name: "usage all-window model breakdown covering (breakdownByModel)",
    index: "llm_usage_model_cover_idx",
    sql: `SELECT provider, model, count(*), sum(cost_usd)
          FROM llm_usage INDEXED BY llm_usage_model_cover_idx
          GROUP BY provider, model`,
  },
  {
    name: "usage bounded-window task breakdown prunes created_at (breakdownByTask)",
    index: "llm_usage_created_at_idx",
    sql: `SELECT task, provider, model, count(*), sum(cost_usd)
          FROM llm_usage INDEXED BY llm_usage_created_at_idx
          WHERE created_at >= 0 GROUP BY task, provider, model`,
  },
  {
    name: "usage bounded-window model breakdown prunes created_at (breakdownByModel)",
    index: "llm_usage_created_at_idx",
    sql: `SELECT provider, model, count(*), sum(cost_usd)
          FROM llm_usage INDEXED BY llm_usage_created_at_idx
          WHERE created_at >= 0 GROUP BY provider, model`,
  },
  {
    name: "usage totals covering (totalsByWindow)",
    index: "llm_usage_totals_cover_idx",
    sql: `SELECT count(*), sum(input_tokens), sum(cached_input_tokens),
                 sum(output_tokens), sum(reasoning_tokens), sum(cost_usd)
          FROM llm_usage INDEXED BY llm_usage_totals_cover_idx WHERE created_at >= 0`,
  },
];

async function main() {
  const client = libsqlClient();

  // Defensive dedupe before the cluster_splits UNIQUE index below: it throws on
  // any duplicate (item_id, from_cluster_id) pair. The 2026-07-12 migration
  // deduped once, but the cluster pipeline runs continuously — if a re-rejection
  // appended a dup in the window before the index existed, CREATE UNIQUE INDEX
  // would abort the whole run. Idempotent (0 rows once clean). Review finding 3a.
  const dedupe = await client.execute(`
    DELETE FROM cluster_splits WHERE EXISTS (
      SELECT 1 FROM cluster_splits cs2
      WHERE cs2.item_id = cluster_splits.item_id
        AND cs2.from_cluster_id = cluster_splits.from_cluster_id
        AND cs2.id < cluster_splits.id)`);
  if (dedupe.rowsAffected > 0) {
    console.log(
      `cluster_splits: deduped ${dedupe.rowsAffected} duplicate pair(s) before unique index`,
    );
  }

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
