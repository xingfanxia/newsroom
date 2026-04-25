import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { items, sources, policyVersions } from "@/db/schema";
import type { RadarStats } from "@/components/feed/radar-widget";
import type { PulsePoint } from "@/components/shell/pulse-box";
import type { TopicEntry } from "@/components/feed/right-rail";

/** Items-today / P1 / featured / tracked-source counts for the radar widget. */
export async function getRadarStats(): Promise<RadarStats> {
  const client = db();
  // Cast the Date param inline to `::timestamptz`: drizzle otherwise drops the
  // `items.` table prefix when mixing column refs with typed params and the
  // postgres driver rejects the resulting ambiguous statement.
  const oneDayAgoIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [itemsRow] = await client
    .select({
      today: sql<number>`count(*) filter (where ${items.createdAt} >= ${oneDayAgoIso}::timestamptz)::int`,
      p1: sql<number>`count(*) filter (where ${items.tier} = 'p1')::int`,
      featured: sql<number>`count(*) filter (where ${items.tier} = 'featured')::int`,
    })
    .from(items);

  const [srcRow] = await client
    .select({
      n: sql<number>`count(*) filter (where ${sources.enabled})::int`,
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
      hour: sql<number>`extract(hour from ${items.createdAt})::int`,
      n: sql<number>`count(*)::int`,
    })
    .from(items)
    .where(gte(items.createdAt, oneDayAgo))
    .groupBy(sql`extract(hour from ${items.createdAt})`);

  const byHour = Object.fromEntries(rows.map((r) => [r.hour, r.n]));
  return Array.from({ length: 24 }, (_, h) => ({ h, c: byHour[h] ?? 0 }));
}

/** Top tags across enriched items over the last 7 days. */
export async function getTopTopics(limit = 16): Promise<TopicEntry[]> {
  const client = db();
  const cutoffIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  // `::timestamptz` cast is load-bearing: postgres driver rejects ambiguous
  // statements when a Date param mixes with qualified column refs. Same fix
  // as getRadarStats.
  const rows = await client.execute(sql`
    SELECT t AS tag, count(*)::int AS n
    FROM ${items},
      LATERAL jsonb_array_elements_text(
        coalesce(${items.tags}->'capabilities', '[]'::jsonb)
        || coalesce(${items.tags}->'entities',     '[]'::jsonb)
        || coalesce(${items.tags}->'topics',       '[]'::jsonb)
      ) AS t
    WHERE ${items.createdAt} >= ${cutoffIso}::timestamptz
      AND ${items.enrichedAt} IS NOT NULL
    GROUP BY t
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
 * Calendar-grid counts. Must agree exactly with the date-filter in
 * lib/items/live.ts — clicking a calendar cell must return the items the
 * count promised.
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
 */
export async function getDayCounts(days = 30): Promise<DayBucket[]> {
  const client = db();
  const rows = await client.execute(sql`
    SELECT to_char(date_trunc('day', i.published_at), 'YYYY-MM-DD') AS d,
           count(*)::int AS n
    FROM items i
    LEFT JOIN clusters c ON c.id = i.cluster_id
    WHERE i.enriched_at IS NOT NULL
      AND i.importance IS NOT NULL
      AND coalesce(c.event_tier, i.tier, 'all') <> 'excluded'
      AND (i.cluster_id IS NULL OR c.lead_item_id = i.id)
      AND i.published_at >= now() - (${days} * interval '1 day')
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
  const ageMs = Date.now() - row[0].committedAt.getTime();
  const ageH = Math.round(ageMs / 3_600_000);
  const ageD = Math.round(ageH / 24);
  const ago = ageH < 1 ? "just now" : ageH < 24 ? `${ageH} hrs ago` : `${ageD} d ago`;
  return { version: `v${row[0].version}`, lastIterAt: ago };
}

// Avoid unused import warning — `and` / `isNotNull` kept for future composed filters.
void and;
void isNotNull;
