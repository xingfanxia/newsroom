import { and, eq, sql, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import { items, sources, clusters } from "@/db/schema";
import {
  DEFAULT_FEED_HOT_WINDOW_HOURS,
  DEFAULT_FEED_LIMIT,
  DEFAULT_FEED_OFFSET,
  DEFAULT_FEED_TIER,
  DEFAULT_FEED_VIEW,
  DEFAULT_STORY_FEED_LOCALE,
} from "@/lib/feed/query-defaults";
import { highlightTierInSql } from "@/lib/items/tier-sql";
import {
  eventStorySelectFields,
  storySelectFields,
} from "@/lib/items/story-select";
import { toStory } from "@/lib/items/story-mapper";
import {
  type AppLocale,
  type FeedView,
  type SourceGroup,
  type SourceKind,
  type Story,
  type VisibleItemTier,
} from "@/lib/types";

export type FeedQuery = {
  tier?: VisibleItemTier;
  locale?: AppLocale;
  limit?: number;
  /** Skip the first N items — for pagination. Defaults to 0. */
  offset?: number;
  /** Filter by exact source.id — used by /podcasts per-channel, /x-monitor
   *  per-handle, and the public API's ?source_id= param. Takes precedence
   *  over sourceGroup/sourceKind when set. */
  sourceId?: string;
  /** Filter by source.group — e.g. "podcast" for the /podcasts page. */
  sourceGroup?: SourceGroup;
  /** Filter by source.kind — e.g. "x-api" for the /x-monitor page. */
  sourceKind?: SourceKind;
  /** Restrict to items whose published_at falls on this calendar day
   *  (UTC, YYYY-MM-DD). Used by the /all day-picker. */
  date?: string;
  /** ISO-8601 lower bound on published_at (inclusive). Used by /api/v1/feed's
   *  date_from window. Ignored when `date` is set. */
  dateFrom?: string;
  /** ISO-8601 upper bound on published_at (exclusive). Used by /api/v1/feed's
   *  date_to window. Ignored when `date` is set. */
  dateTo?: string;
  /** Include the story's source-group so UI can show format badges
   *  (podcast/vendor-official/media/…). Defaults to false for home feed. */
  includeSourceGroup?: boolean;
  /** Case-insensitive substring match against title + both-locale
   *  title/summary columns. Used by /api/v1/search lexical mode. Raw
   *  input is passed to ILIKE without escaping, so callers who need
   *  literal `%` or `_` should pre-escape (v1 behavior; ok for keyword
   *  search, revisit if power-user wildcards cause surprises). */
  searchText?: string;
  /** Restrict to items from `sources.curated = true`. Powers the AX 严选
   *  nav tab — operator hand-picks publishers worth surfacing even if the
   *  scorer's tier is low. */
  curatedOnly?: boolean;
  /** Drop any source whose tags overlap this list. Postgres `&&` overlap operator. */
  excludeSourceTags?: string[];
  /** Inverse of excludeSourceTags — only return items whose source tags overlap this list. */
  includeSourceTags?: string[];
  /** Event-aggregation view semantics. Historical rationale lives in
   *  docs/aggregation/DESIGN.md §7; current behavior is this module plus
   *  docs/architecture/ingestion.md.
   *   'today'   = trending: events with firstSeenAt today OR latestMemberAt
   *               within hotWindowHours, plus fresh singletons from today.
   *               Ordered by latestMemberAt DESC then importance DESC.
   *   'archive' = calendar: events bucketed on firstSeenAt day. Ordered by
   *               firstSeenAt DESC then importance DESC.
   *   Default: 'archive' (backwards-compatible with existing home-feed
   *   behavior until UI cutover sets 'today' explicitly). */
  view?: FeedView;
  /** Hot window in hours for the Today view's "still-developing" cutoff.
   *  Defaults to 24. Wider window keeps multi-day stories visible longer. */
  hotWindowHours?: number;
  /** Quality threshold on the effective importance (cluster.importance when
   *  multi-member, else item.importance). Items below this score are filtered
   *  out. Used by the home page's daily-highlights default (≥ 80) so the
   *  feed surfaces the day's events worth reading instead of mid-tier noise.
   *  Per-tab overrides drop this to 0 to expose the full pool. */
  minImportance?: number;
  /** Daily-highlights mode: cap items per calendar day (UTC). Pairs with
   *  `minImportance` to give the home page a clean "top-N stories per day"
   *  timeline that browses backward in time without burying days under
   *  their own internal volume. Set to 1 for a strict one-per-day timeline
   *  or 3-5 for a "day digest" feel. Items within a day come out in
   *  importance-DESC order then publishedAt-DESC tiebreaker. */
  maxPerDay?: number;
  /** Bypass `minImportance` for items published in the last N calendar days.
   *  Stage D cluster-importance scoring runs periodically and lags ingestion
   *  by 1-2 days — without rescue, recent days that have leads but none yet
   *  pushed to imp >= threshold get skipped, so the home feed appears to
   *  start "3 days ago." `maxPerDay` still bounds each rescued day to its
   *  top-N by importance, so noise stays capped. Day-aligned (not rolling
   *  24h) so the rescue boundary doesn't drift across the day. */
  recentDayRescueDays?: number;
};

/**
 * Build the shared WHERE expression used by both getFeaturedStories and
 * countFeaturedStories so pagination totals can't drift from the
 * actually-returned rows.
 */
function buildFeedWhere(q: FeedQuery) {
  const tier: VisibleItemTier = q.tier ?? DEFAULT_FEED_TIER;
  const view = q.view ?? DEFAULT_FEED_VIEW;
  const hotH = q.hotWindowHours ?? DEFAULT_FEED_HOT_WINDOW_HOURS;

  // Event-aware tier filter: prefer cluster.event_tier when the item is part of
  // a cluster (multi-member events get their own tier from coverage boost +
  // Stage D re-score); fall back to items.tier for singletons + unclustered.
  const effectiveTier = sql`COALESCE(${clusters.eventTier}, ${items.tier})`;

  // Tiers are inclusive: "featured" shows featured+p1; "all" shows everything non-excluded.
  const tierFilter =
    tier === "p1"
      ? sql`${effectiveTier} = 'p1'`
      : tier === "featured"
        ? highlightTierInSql(effectiveTier)
        : sql`${effectiveTier} <> 'excluded'`;

  // Cluster dedup: only return the item that's its cluster's lead.
  // Unclustered-but-enriched items are surfaced as-is (no cluster yet).
  const dedupFilter = sql`(${items.clusterId} IS NULL OR ${clusters.leadItemId} = ${items.id})`;

  const sourceIdFilter = q.sourceId
    ? sql`${items.sourceId} = ${q.sourceId}`
    : sql`TRUE`;
  const groupFilter = !q.sourceId && q.sourceGroup
    ? sql`${sources.group} = ${q.sourceGroup}`
    : sql`TRUE`;
  const kindFilter = !q.sourceId && q.sourceKind
    ? sql`${sources.kind} = ${q.sourceKind}`
    : sql`TRUE`;
  // View-aware day filter. Bucket anchor for date filtering = items.published_at.
  // The dedup filter above ensures we only count/show the lead item per cluster,
  // so items.published_at IS the lead's published_at for events. This matches
  // calendar getDayCounts() and the user's intuition ("clicking April 16 shows
  // events whose lead coverage dropped April 16").
  //
  // Earlier iterations used COALESCE(cluster.first_seen_at, items.published_at)
  // which buckets events on their EARLIEST member's day — so an event whose
  // first source dropped April 14 but whose lead coverage came April 16 would
  // sit in the April 14 calendar cell, leaving April 16 empty even though the
  // user thinks of it as an April 16 event.
  //
  //   today:   combined trending — match ANY of:
  //              (1) cluster firstSeenAt today (newly broken event), OR
  //              (2) cluster latestMemberAt within hotWindow (still developing), OR
  //              (3) item published since the start of yesterday (fresh-but-
  //                  cold rescue, day-aligned so it doesn't drift with clock).
  //
  //            Without (3), a fresh article from yesterday that joined a cold
  //            singleton cluster (cluster.first_seen_at = yesterday, no later
  //            members so latest_member_at also yesterday → > 24h ago) was
  //            invisible on the home page despite being recent + high-tier.
  //            That's how "热点聚合" ended up showing 04-22 stories on top
  //            ("持续报道 · 1d" because they got a NEW member today) while
  //            burying yesterday's actual fresh articles in cold singleton
  //            clusters. Day-aligned via date_trunc so an item published
  //            yesterday morning still shows when checked this afternoon
  //            (a relative `> now() - 24h` window would drop it after lunch).
  //            Same tier filter still gates quality.
  //   explicit date filter (q.date / q.dateFrom/dateTo) overrides view.
  const dateFilter = q.date
    ? sql`${items.publishedAt} >= ${`${q.date}T00:00:00Z`}::timestamptz AND ${items.publishedAt} < ${`${q.date}T00:00:00Z`}::timestamptz + interval '1 day'`
    : q.dateFrom || q.dateTo
      ? sql`${items.publishedAt} >= ${q.dateFrom ?? "1970-01-01"}::timestamptz AND ${items.publishedAt} < ${q.dateTo ?? "2999-01-01"}::timestamptz`
      : view === "today"
        ? sql`(
            ${clusters.firstSeenAt} >= date_trunc('day', now())
            OR ${clusters.latestMemberAt} > now() - make_interval(hours => ${hotH})
            OR ${items.publishedAt} >= date_trunc('day', now() - interval '1 day')
          )`
        : sql`TRUE`;

  const searchFilter = q.searchText
    ? sql`(
        ${items.title} ILIKE ${`%${q.searchText}%`} OR
        ${items.titleZh} ILIKE ${`%${q.searchText}%`} OR
        ${items.titleEn} ILIKE ${`%${q.searchText}%`} OR
        ${items.summaryZh} ILIKE ${`%${q.searchText}%`} OR
        ${items.summaryEn} ILIKE ${`%${q.searchText}%`} OR
        ${clusters.canonicalTitleZh} ILIKE ${`%${q.searchText}%`} OR
        ${clusters.canonicalTitleEn} ILIKE ${`%${q.searchText}%`}
      )`
    : sql`TRUE`;

  const curatedFilter = q.curatedOnly
    ? sql`${sources.curated} = TRUE`
    : sql`TRUE`;

  // Drizzle binds a JS array via `${arr}` as a tuple `($1, $2)`, not a Postgres
  // ARRAY literal — that produces `ARRAY['x'] && ($1, $2)::text[]` which the
  // planner rejects. Build the array explicitly with sql.join.
  const excludeTagsFilter =
    q.excludeSourceTags && q.excludeSourceTags.length > 0
      ? sql`NOT (${sources.tags} && ARRAY[${sql.join(
          q.excludeSourceTags.map((t) => sql`${t}`),
          sql`, `,
        )}]::text[])`
      : sql`TRUE`;

  const includeTagsFilter =
    q.includeSourceTags && q.includeSourceTags.length > 0
      ? sql`${sources.tags} && ARRAY[${sql.join(
          q.includeSourceTags.map((t) => sql`${t}`),
          sql`, `,
        )}]::text[]`
      : sql`TRUE`;

  // Effective-importance threshold. Cluster importance (Stage D) wins when
  // present — a multi-source event with coverage boost can sit above its
  // lead's raw importance.
  //
  // recentDayRescueDays bypasses the threshold for items published in the
  // last N calendar days — covers the scoring-pipeline lag where the most
  // recent days have leads but Stage D hasn't pumped them to imp >= threshold
  // yet. Day-aligned via date_trunc so the cutoff doesn't drift mid-day.
  const minImportanceFilter =
    q.minImportance != null && q.minImportance > 0
      ? q.recentDayRescueDays != null && q.recentDayRescueDays > 0
        ? sql`(
            COALESCE(${clusters.importance}, ${items.importance}) >= ${q.minImportance}
            OR ${items.publishedAt} >= date_trunc('day', now() - make_interval(days => ${q.recentDayRescueDays - 1}))
          )`
        : sql`COALESCE(${clusters.importance}, ${items.importance}) >= ${q.minImportance}`
      : sql`TRUE`;

  return and(
    isNotNull(items.enrichedAt),
    isNotNull(items.importance),
    tierFilter,
    dedupFilter,
    sourceIdFilter,
    groupFilter,
    kindFilter,
    dateFilter,
    searchFilter,
    curatedFilter,
    excludeTagsFilter,
    includeTagsFilter,
    minImportanceFilter,
  );
}

/**
 * Fetch the curated feed for the home page timeline.
 * Returns Story[] in the shape the existing UI expects.
 * Only one item per cluster (the lead), with memberCount surfaced as crossSourceCount.
 */
export async function getFeaturedStories(q: FeedQuery = {}): Promise<Story[]> {
  const limit = q.limit ?? DEFAULT_FEED_LIMIT;
  const offset = q.offset ?? DEFAULT_FEED_OFFSET;
  const client = db();

  // Default ordering: lead's published_at first (so old still-developing events
  // don't beat fresh news on importance ties — many P1s sit at 100), importance
  // as tiebreaker.
  //
  // When `maxPerDay` is set, swap the primary sort to day-then-importance so
  // each day's strongest leads come out first; the TS-side cap below keeps
  // the top-N per day. This is the home page's daily-highlights default —
  // a few important stories per day instead of multiple mid-tier items
  // competing for attention.
  const useDayCap = q.maxPerDay != null && q.maxPerDay > 0;
  const orderExpr = useDayCap
    ? sql`to_char(${items.publishedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD') DESC,
          COALESCE(${clusters.importance}, ${items.importance}) DESC,
          ${items.publishedAt} DESC`
    : sql`${items.publishedAt} DESC, COALESCE(${clusters.importance}, ${items.importance}) DESC`;

  // maxPerDay needs a wider fetch window than `limit` because we may discard
  // many rows per day above the cap. Heuristic: 5x typical-discard headroom
  // (most filtered-out rows per day sit in the 5-20 range), with a 200-row
  // floor so quiet days don't starve the timeline, and a 500-row ceiling to
  // bound DB cost.
  const fetchLimit = useDayCap
    ? Math.min(Math.max(limit * 5, 200), 500)
    : limit;

  const rows = await client
    .select({
      ...storySelectFields,
      ...eventStorySelectFields,
    })
    .from(items)
    .innerJoin(sources, eq(items.sourceId, sources.id))
    .leftJoin(clusters, eq(items.clusterId, clusters.id))
    .where(buildFeedWhere(q))
    .orderBy(orderExpr)
    .limit(fetchLimit)
    .offset(offset);

  // maxPerDay: SQL is sorted day-DESC then importance-DESC, so the first N
  // rows we encounter for each calendar day are that day's strongest leads.
  // Walk the rows once, keep up to `maxPerDay` per day, stop at `limit` total.
  const dedupedRows = useDayCap
    ? (() => {
        const counts = new Map<string, number>();
        const cap = q.maxPerDay!;
        const out: typeof rows = [];
        for (const r of rows) {
          const day = r.publishedAt.toISOString().slice(0, 10);
          const count = counts.get(day) ?? 0;
          if (count >= cap) continue;
          counts.set(day, count + 1);
          out.push(r);
          if (out.length >= limit) break;
        }
        return out;
      })()
    : rows;

  const hotWindowMs =
    (q.hotWindowHours ?? DEFAULT_FEED_HOT_WINDOW_HOURS) * 3_600_000;
  const now = Date.now();
  const startOfTodayMs = (() => {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    return d.getTime();
  })();
  const locale = q.locale ?? DEFAULT_STORY_FEED_LOCALE;

  return dedupedRows.map((r): Story =>
    toStory(r, {
      locale,
      tagLimit: 4,
      includeSourceGroup: q.includeSourceGroup,
      nowMs: now,
      startOfTodayMs,
      hotWindowMs,
    }),
  );
}

/**
 * List all members of a cluster (event) for the signal-drawer UI.
 *
 * Ordered by importance DESC (most authoritative / high-signal member first),
 * then publishedAt ASC (earliest covering source at the top of ties). Per-member
 * roles (primary / corroborating) are intentionally not modeled — this ordering
 * produces the same editorial surface with less schema surface area.
 *
 * Returns an empty array for clusters that don't exist (safe for agents that
 * call without checking the feed response first).
 */
export async function getEventMembers(
  clusterId: number,
  locale: AppLocale = "zh",
): Promise<NonNullable<Story["members"]>> {
  const client = db();
  const rows = await client
    .select({
      sourceId: items.sourceId,
      sourceNameZh: sources.nameZh,
      sourceNameEn: sources.nameEn,
      titleZh: items.titleZh,
      titleEn: items.titleEn,
      rawTitle: items.title,
      url: items.url,
      publishedAt: items.publishedAt,
      importance: items.importance,
    })
    .from(items)
    .innerJoin(sources, eq(items.sourceId, sources.id))
    .where(eq(items.clusterId, clusterId))
    .orderBy(sql`${items.importance} DESC NULLS LAST, ${items.publishedAt} ASC`);

  return rows.map((r) => ({
    sourceId: r.sourceId,
    sourceName: (locale === "en" ? r.sourceNameEn : r.sourceNameZh) ?? r.sourceId,
    title:
      locale === "en"
        ? (r.titleEn ?? r.titleZh ?? r.rawTitle)
        : (r.titleZh ?? r.titleEn ?? r.rawTitle),
    url: r.url,
    publishedAt: r.publishedAt.toISOString(),
    importance: r.importance ?? 0,
  }));
}

/**
 * COUNT(*) over the same feed filters as getFeaturedStories — used by the
 * /api/v1/feed response's `total` field so agents can page through results.
 * The JOIN on clusters is preserved because the dedup filter references it.
 */
export async function countFeaturedStories(q: FeedQuery = {}): Promise<number> {
  const client = db();
  const [row] = await client
    .select({ c: sql<number>`count(*)::int` })
    .from(items)
    .innerJoin(sources, eq(items.sourceId, sources.id))
    .leftJoin(clusters, eq(items.clusterId, clusters.id))
    .where(buildFeedWhere(q));
  return row?.c ?? 0;
}
