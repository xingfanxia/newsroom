import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { items, sources, policyVersions } from "@/db/schema";
import { highlightTierInSql } from "@/lib/items/tier-sql";
import { formatCoarseRelativeTime } from "@/lib/time/relative";
import type { RadarStats } from "@/lib/shell/radar-stats";
import type { PulsePoint } from "@/components/shell/pulse-box";
import type { TopicEntry } from "@/components/feed/right-rail";

/** Items-today / P1 / featured / tracked-source counts for the radar widget. */
export async function getRadarStats(): Promise<RadarStats> {
  const client = db();
  // Timestamps are integer ms epoch (Turso migration) — bind plain numbers.
  const oneDayAgoMs = Date.now() - 24 * 60 * 60 * 1000;

  // Outer WHERE repeats the shared created_at bound (every FILTER already
  // implies it) so the query is a pure range scan on items_created_tier_idx
  // instead of a full-table aggregate over the payload-heavy rows
  // (3s → ms, 2026-07-12).
  const [itemsRow] = await client
    .select({
      today: sql<number>`count(*)`,
      p1: sql<number>`count(*) filter (where ${items.tier} = 'p1')`,
      featured: sql<number>`count(*) filter (where ${items.tier} = 'featured')`,
    })
    .from(items)
    .where(sql`${items.createdAt} >= ${oneDayAgoMs}`);

  const [srcRow] = await client
    .select({
      n: sql<number>`count(*) filter (where ${sources.enabled})`,
    })
    .from(sources);

  return {
    items_today: itemsRow?.today ?? 0,
    items_p1: itemsRow?.p1 ?? 0,
    items_featured: itemsRow?.featured ?? 0,
    tracked_sources: srcRow?.n ?? 0,
  };
}

/** 24 hourly buckets over the past day. Each bucket.c = items normalized in that UTC hour. */
export async function getPulseData(): Promise<PulsePoint[]> {
  const client = db();
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  // `gte(items.createdAt, Date)` keeps the table-qualified column name in the
  // WHERE clause, avoiding the same ambiguous-param issue as getRadarStats.
  const rows = await client
    .select({
      hour: sql<number>`CAST(strftime('%H', ${items.createdAt} / 1000.0, 'unixepoch') AS INTEGER)`,
      n: sql<number>`count(*)`,
    })
    .from(items)
    .where(gte(items.createdAt, oneDayAgo))
    .groupBy(sql`strftime('%H', ${items.createdAt} / 1000.0, 'unixepoch')`);

  const byHour = Object.fromEntries(rows.map((r) => [r.hour, r.n]));
  return Array.from({ length: 24 }, (_, h) => ({ h, c: byHour[h] ?? 0 }));
}

/** Top tags across enriched items over the last 7 days. */
export async function getTopTopics(limit = 16): Promise<TopicEntry[]> {
  const client = db();
  const cutoffMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
  // items.tags is JSON text with three array keys; SQLite has no jsonb `||`
  // array concat, so the three keys are unnested as UNION ALL branches of
  // json_each (table-valued function — no LATERAL keyword needed).
  //
  // The 7-day slice is materialized ONCE (was three separate scans) and the
  // scan is answered entirely by items_topics_cover_idx (created_at, tags —
  // partial on enriched), so it never touches the payload-heavy table pages.
  const rows = await client.all<{ tag: string; n: number }>(sql`
    WITH recent AS MATERIALIZED (
      SELECT ${items.tags} AS tags
      FROM ${items} INDEXED BY items_topics_cover_idx
      WHERE ${items.createdAt} >= ${cutoffMs} AND ${items.enrichedAt} IS NOT NULL
    ),
    tag_values AS (
      SELECT je.value AS tag
      FROM recent, json_each(coalesce(json_extract(recent.tags, '$.capabilities'), '[]')) je
      UNION ALL
      SELECT je.value AS tag
      FROM recent, json_each(coalesce(json_extract(recent.tags, '$.entities'), '[]')) je
      UNION ALL
      SELECT je.value AS tag
      FROM recent, json_each(coalesce(json_extract(recent.tags, '$.topics'), '[]')) je
    )
    SELECT tag, count(*) AS n
    FROM tag_values
    GROUP BY tag
    ORDER BY n DESC
    LIMIT ${limit}
  `);
  const peak = rows[0]?.n ?? 1;
  return rows.map((r) => {
    const tag = String(r.tag);
    const n = Number(r.n);
    return {
      tag,
      count: n,
      hot: n >= Number(peak) * 0.6,
    };
  });
}

/**
 * Items-per-day counts for the /all day-picker. Returns the most recent `days`
 * buckets newest-first, each with its ISO date key and item count.
 *
 * Counts match getFeaturedStories tier='all' filters: enriched + importance
 * set + non-excluded, so UI counts don't over-promise items that won't render.
 */
export type DayBucket = { date: string; count: number };
/**
 * Calendar-grid counts. Must agree exactly with the per-page feed filters
 * in lib/items/live.ts — clicking a calendar cell must return the items
 * the count promised. Each page (home / all / curated) passes
 * its own filter slice so the cell number matches what'll render.
 *
 * Bucket anchor = lead item's published_at:
 *   - Singletons (cluster_id NULL) bucket on their own published_at.
 *   - Multi-member events bucket on the lead item's published_at, which
 *     since dedup filters i.id = c.lead_item_id IS just i.published_at —
 *     no separate join needed. (This was a regression from an earlier
 *     iteration that bucketed on cluster.first_seen_at; that anchor places
 *     events on their earliest-member day, which often contradicts the
 *     intuitive "the day the event happened" — i.e. when the lead's
 *     coverage was published.)
 *   - Excluded tier honored via COALESCE(cluster.event_tier, items.tier).
 *
 * `opts.tier` narrows beyond the default <> 'excluded' (e.g., 'featured'
 * for the home page so the cell counts only featured+p1 leads, matching
 * the feed query). `opts.excludeSourceTags` / `includeSourceTags` /
 * `curatedOnly` mirror the same-named FeedQuery fields. JOIN on sources
 * is unconditional so we can apply them; the planner skips the JOIN when
 * no source-side filter is referenced.
 */
export async function getDayCounts(
  days = 30,
  opts?: {
    excludeSourceTags?: string[];
    includeSourceTags?: string[];
    curatedOnly?: boolean;
    tier?: "featured" | "all" | "p1";
  },
): Promise<DayBucket[]> {
  const client = db();

  // Tier filter mirrors buildFeedWhere — 'featured' is inclusive (featured+p1).
  const tier = opts?.tier ?? "all";
  const tierFilter =
    tier === "p1"
      ? sql`coalesce(c.event_tier, i.tier) = 'p1'`
      : tier === "featured"
        ? highlightTierInSql(sql`coalesce(c.event_tier, i.tier)`)
        : sql`coalesce(c.event_tier, i.tier, 'all') <> 'excluded'`;

  // s.tags is a JSON-text array — overlap tests go through json_each, same
  // shape as buildFeedWhere in lib/items/live.ts.
  const excludeTagsFilter =
    opts?.excludeSourceTags && opts.excludeSourceTags.length > 0
      ? sql`AND NOT EXISTS (
          SELECT 1 FROM json_each(s.tags)
          WHERE json_each.value IN (${sql.join(
            opts.excludeSourceTags.map((t) => sql`${t}`),
            sql`, `,
          )})
        )`
      : sql``;

  const includeTagsFilter =
    opts?.includeSourceTags && opts.includeSourceTags.length > 0
      ? sql`AND EXISTS (
          SELECT 1 FROM json_each(s.tags)
          WHERE json_each.value IN (${sql.join(
            opts.includeSourceTags.map((t) => sql`${t}`),
            sql`, `,
          )})
        )`
      : sql``;

  const curatedFilter = opts?.curatedOnly
    ? sql`AND s.curated = TRUE`
    : sql``;

  // INDEXED BY items_feed_recent_idx (published_at LEADS): this query ALWAYS
  // carries a `published_at >= floor` bound, so the recency index SEEKs the
  // window (~a few thousand rows) instead of scanning every enriched row.
  // items_feed_cover_idx (published_at LAST, the W7 choice) answered the filter
  // phase from slim index pages but still walked the whole enriched corpus — an
  // unbounded scan that grows forever; the recent index bounds it to `days`.
  // Both cover the same items columns, so this stays index-only (no fat-row
  // lookups). W9b — mirrors getFeaturedStories' feedIndexFor() seek choice.
  const rows = await client.all<{ d: string; n: number }>(sql`
    SELECT strftime('%Y-%m-%d', i.published_at / 1000.0, 'unixepoch') AS d,
           count(*) AS n
    FROM items i INDEXED BY items_feed_recent_idx
    JOIN sources s ON s.id = i.source_id
    LEFT JOIN clusters c INDEXED BY clusters_feed_cover_idx
      ON c.id = i.cluster_id
    WHERE i.enriched_at IS NOT NULL
      AND i.importance IS NOT NULL
      AND ${tierFilter}
      AND (i.cluster_id IS NULL OR c.lead_item_id = i.id)
      AND i.published_at >= ${Date.now() - days * 86_400_000}
      ${excludeTagsFilter}
      ${includeTagsFilter}
      ${curatedFilter}
    GROUP BY 1
    ORDER BY 1 DESC
    LIMIT ${days}
  `);
  return rows.map((r) => ({ date: String(r.d), count: Number(r.n) }));
}

/** Latest committed policy version label + when last iteration landed. */
export async function getPolicySummary(): Promise<{
  version: string;
  lastIterAt: string | null;
}> {
  const client = db();
  const row = await client
    .select({
      version: policyVersions.version,
      committedAt: policyVersions.committedAt,
    })
    .from(policyVersions)
    .where(eq(policyVersions.skillName, "editorial"))
    .orderBy(sql`${policyVersions.version} desc`)
    .limit(1);

  if (row.length === 0) {
    return { version: "v1", lastIterAt: null };
  }
  return {
    version: `v${row[0].version}`,
    lastIterAt: formatCoarseRelativeTime(row[0].committedAt, {
      currentLabel: "just now",
      hourSuffix: " hrs",
      daySuffix: " d",
      rounding: "round",
    }),
  };
}

// Avoid unused import warning — `and` / `isNotNull` kept for future composed filters.
void and;
void isNotNull;
