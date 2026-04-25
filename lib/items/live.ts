import { and, desc, eq, sql, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import { items, sources, clusters } from "@/db/schema";
import type { Story } from "@/lib/types";

type Tier = "featured" | "all" | "p1";
type Locale = "zh" | "en";

export type FeedQuery = {
  tier?: Tier;
  locale?: Locale;
  limit?: number;
  /** Skip the first N items — for pagination. Defaults to 0. */
  offset?: number;
  /** Filter by exact source.id — used by /podcasts per-channel, /x-monitor
   *  per-handle, and the public API's ?source_id= param. Takes precedence
   *  over sourceGroup/sourceKind when set. */
  sourceId?: string;
  /** Filter by source.group — e.g. "podcast" for the /podcasts page. */
  sourceGroup?: string;
  /** Filter by source.kind — e.g. "x-api" for the /x-monitor page. */
  sourceKind?: string;
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
  /** Drop any source whose tags overlap this list. The home (热点聚合) feed
   *  uses this to keep arxiv/paper content out of the news view — papers
   *  live on the dedicated /papers tab. Postgres `&&` overlap operator. */
  excludeSourceTags?: string[];
  /** Inverse of excludeSourceTags — only return items whose source tags
   *  overlap this list. Powers the /papers tab. */
  includeSourceTags?: string[];
  /** Event-aggregation view semantics (see docs/aggregation/DESIGN.md §7).
   *   'today'   = trending: events with firstSeenAt today OR latestMemberAt
   *               within hotWindowHours, plus fresh singletons from today.
   *               Ordered by latestMemberAt DESC then importance DESC.
   *   'archive' = calendar: events bucketed on firstSeenAt day. Ordered by
   *               firstSeenAt DESC then importance DESC.
   *   Default: 'archive' (backwards-compatible with existing home-feed
   *   behavior until UI cutover sets 'today' explicitly). */
  view?: "today" | "archive";
  /** Hot window in hours for the Today view's "still-developing" cutoff.
   *  Defaults to 24. Wider window keeps multi-day stories visible longer. */
  hotWindowHours?: number;
};

/**
 * Build the shared WHERE expression used by both getFeaturedStories and
 * countFeaturedStories so pagination totals can't drift from the
 * actually-returned rows.
 */
function buildFeedWhere(q: FeedQuery) {
  const tier: Tier = q.tier ?? "featured";
  const view = q.view ?? "archive";
  const hotH = q.hotWindowHours ?? 24;

  // Event-aware tier filter: prefer cluster.event_tier when the item is part of
  // a cluster (multi-member events get their own tier from coverage boost +
  // Stage D re-score); fall back to items.tier for singletons + unclustered.
  const effectiveTier = sql`COALESCE(${clusters.eventTier}, ${items.tier})`;

  // Tiers are inclusive: "featured" shows featured+p1; "all" shows everything non-excluded.
  const tierFilter =
    tier === "p1"
      ? sql`${effectiveTier} = 'p1'`
      : tier === "featured"
        ? sql`${effectiveTier} IN ('featured', 'p1')`
        : sql`${effectiveTier} <> 'excluded'`;

  // Cluster dedup: only return the item that's its cluster's lead.
  // Unclustered-but-enriched items are surfaced as-is (no cluster yet).
  const dedupFilter = sql`(${items.clusterId} IS NULL OR ${clusters.leadItemId} = ${items.id})`;

  const sourceIdFilter = q.sourceId
    ? sql`${items.sourceId} = ${q.sourceId}`
    : sql`TRUE`;
  const groupFilter = q.sourceGroup
    ? sql`${sources.group} = ${q.sourceGroup}`
    : sql`TRUE`;
  const kindFilter = q.sourceKind
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
  //   today:   combined trending — firstSeenAt today OR latestMemberAt within
  //            hotWindow OR unclustered-item published today.
  //   explicit date filter (q.date / q.dateFrom/dateTo) overrides view.
  const dateFilter = q.date
    ? sql`${items.publishedAt} >= ${`${q.date}T00:00:00Z`}::timestamptz AND ${items.publishedAt} < ${`${q.date}T00:00:00Z`}::timestamptz + interval '1 day'`
    : q.dateFrom || q.dateTo
      ? sql`${items.publishedAt} >= ${q.dateFrom ?? "1970-01-01"}::timestamptz AND ${items.publishedAt} < ${q.dateTo ?? "2999-01-01"}::timestamptz`
      : view === "today"
        ? sql`(
            ${clusters.firstSeenAt} >= date_trunc('day', now())
            OR ${clusters.latestMemberAt} > now() - make_interval(hours => ${hotH})
            OR (${items.clusterId} IS NULL AND ${items.publishedAt} >= date_trunc('day', now()))
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

  const excludeTagsFilter =
    q.excludeSourceTags && q.excludeSourceTags.length > 0
      ? sql`NOT (${sources.tags} && ${q.excludeSourceTags}::text[])`
      : sql`TRUE`;

  const includeTagsFilter =
    q.includeSourceTags && q.includeSourceTags.length > 0
      ? sql`${sources.tags} && ${q.includeSourceTags}::text[]`
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
  );
}

/**
 * Fetch the curated feed for the home page timeline.
 * Returns Story[] in the shape the existing UI expects.
 * Only one item per cluster (the lead), with memberCount surfaced as crossSourceCount.
 */
export async function getFeaturedStories(q: FeedQuery = {}): Promise<Story[]> {
  const limit = q.limit ?? 40;
  const offset = q.offset ?? 0;
  const client = db();

  const view = q.view ?? "archive";

  // Today view orders by importance — the home feed is "what matters today",
  // not "what was just touched". Recency is a tiebreaker so equally-important
  // events surface the freshest signal first.
  // Archive view stays chronological (matches calendar / date-filter anchor).
  const orderExpr =
    view === "today"
      ? sql`COALESCE(${clusters.importance}, ${items.importance}) DESC NULLS LAST, COALESCE(${clusters.latestMemberAt}, ${items.publishedAt}) DESC`
      : sql`${items.publishedAt} DESC, COALESCE(${clusters.importance}, ${items.importance}) DESC`;

  const rows = await client
    .select({
      id: items.id,
      title: items.title,
      titleZh: items.titleZh,
      titleEn: items.titleEn,
      summaryZh: items.summaryZh,
      summaryEn: items.summaryEn,
      editorNoteZh: items.editorNoteZh,
      editorNoteEn: items.editorNoteEn,
      editorAnalysisZh: items.editorAnalysisZh,
      editorAnalysisEn: items.editorAnalysisEn,
      reasoning: items.reasoning,
      reasoningZh: items.reasoningZh,
      reasoningEn: items.reasoningEn,
      hkr: items.hkr,
      url: items.url,
      importance: items.importance,
      tier: items.tier,
      tags: items.tags,
      publishedAt: items.publishedAt,
      sourceId: items.sourceId,
      sourceNameZh: sources.nameZh,
      sourceNameEn: sources.nameEn,
      sourceLocale: sources.locale,
      sourceKind: sources.kind,
      sourceGroup: sources.group,
      // ── Event-aggregation: cluster-level fields for multi-member events ──
      clusterId: items.clusterId,
      clusterMemberCount: clusters.memberCount,
      clusterCoverage: clusters.coverage,
      clusterFirstSeenAt: clusters.firstSeenAt,
      clusterLatestMemberAt: clusters.latestMemberAt,
      clusterCanonicalTitleZh: clusters.canonicalTitleZh,
      clusterCanonicalTitleEn: clusters.canonicalTitleEn,
      clusterEditorNoteZh: clusters.editorNoteZh,
      clusterEditorNoteEn: clusters.editorNoteEn,
      clusterEditorAnalysisZh: clusters.editorAnalysisZh,
      clusterEditorAnalysisEn: clusters.editorAnalysisEn,
      clusterImportance: clusters.importance,
      clusterEventTier: clusters.eventTier,
      clusterHkr: clusters.hkr,
    })
    .from(items)
    .innerJoin(sources, eq(items.sourceId, sources.id))
    .leftJoin(clusters, eq(items.clusterId, clusters.id))
    .where(buildFeedWhere(q))
    .orderBy(orderExpr)
    .limit(limit)
    .offset(offset);

  const hotWindowMs = (q.hotWindowHours ?? 24) * 3_600_000;
  const now = Date.now();
  const startOfTodayMs = (() => {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    return d.getTime();
  })();

  return rows.map((r): Story => {
    const tagBag = (r.tags ?? {}) as {
      capabilities?: string[];
      entities?: string[];
      topics?: string[];
    };
    // Flatten for UI. Canonical English IDs stored in DB; UI localizes at render.
    const flatTags = [
      ...(tagBag.capabilities ?? []),
      ...(tagBag.entities ?? []),
      ...(tagBag.topics ?? []),
    ].slice(0, 4);

    const publisher =
      q.locale === "en" ? r.sourceNameEn : r.sourceNameZh;

    // Event-aware title fallback ladder:
    //   cluster.canonical_title_<locale>   (LLM-generated neutral event name)
    //   → item.title_<locale>              (item's locale-specific title)
    //   → item.title_<other-locale>        (whichever locale we have)
    //   → item.title                       (raw source title)
    const title =
      q.locale === "en"
        ? (r.clusterCanonicalTitleEn ??
          r.titleEn ??
          r.titleZh ??
          r.title)
        : (r.clusterCanonicalTitleZh ??
          r.titleZh ??
          r.titleEn ??
          r.title);

    // Event-aware editor note/analysis: cluster-level wins when present
    // (multi-member events have commentary at cluster, singletons keep it at item).
    const editorNote =
      q.locale === "en"
        ? (r.clusterEditorNoteEn ??
          r.clusterEditorNoteZh ??
          r.editorNoteEn ??
          r.editorNoteZh)
        : (r.clusterEditorNoteZh ??
          r.clusterEditorNoteEn ??
          r.editorNoteZh ??
          r.editorNoteEn);
    const editorAnalysis =
      q.locale === "en"
        ? (r.clusterEditorAnalysisEn ??
          r.clusterEditorAnalysisZh ??
          r.editorAnalysisEn ??
          r.editorAnalysisZh)
        : (r.clusterEditorAnalysisZh ??
          r.clusterEditorAnalysisEn ??
          r.editorAnalysisZh ??
          r.editorAnalysisEn);

    // Event-aware importance + tier.
    const effectiveImportance = r.clusterImportance ?? r.importance ?? 0;
    const effectiveTier = (r.clusterEventTier ?? r.tier ?? "all") as Story["tier"];

    // Coverage: memberCount when in a multi-member cluster; undefined for singletons.
    const coverage =
      r.clusterMemberCount && r.clusterMemberCount > 1
        ? r.clusterMemberCount
        : undefined;

    // Still-developing: event broke before today AND last new coverage within hot window.
    const firstSeenMs = r.clusterFirstSeenAt?.getTime();
    const latestMemberMs = r.clusterLatestMemberAt?.getTime();
    const stillDeveloping =
      firstSeenMs !== undefined &&
      latestMemberMs !== undefined &&
      firstSeenMs < startOfTodayMs &&
      latestMemberMs > now - hotWindowMs;

    // HKR fallback: cluster-level for multi-member events, item-level otherwise.
    const effectiveHkr =
      (r.clusterHkr as Story["hkr"] | null) ?? (r.hkr as Story["hkr"] | null);

    return {
      id: String(r.id),
      sourceId: r.sourceId,
      source: {
        publisher,
        kindCode: r.sourceKind as Story["source"]["kindCode"],
        localeCode: (r.sourceLocale ?? "multi") as Story["source"]["localeCode"],
        groupCode: q.includeSourceGroup
          ? (r.sourceGroup as Story["source"]["groupCode"])
          : undefined,
      },
      featured: effectiveTier === "featured" || effectiveTier === "p1",
      title,
      summary:
        q.locale === "en"
          ? r.summaryEn ?? r.summaryZh ?? ""
          : r.summaryZh ?? r.summaryEn ?? "",
      tags: flatTags,
      importance: effectiveImportance,
      tier: effectiveTier,
      publishedAt: r.publishedAt.toISOString(),
      url: r.url,
      // crossSourceCount kept for backwards compat; UI migrates to `coverage`.
      crossSourceCount:
        r.clusterMemberCount && r.clusterMemberCount > 1
          ? r.clusterMemberCount - 1
          : undefined,
      locale: (r.sourceLocale ?? "multi") as Story["locale"],
      editorNote: editorNote ?? undefined,
      editorAnalysis: editorAnalysis ?? undefined,
      reasoning:
        q.locale === "en"
          ? r.reasoningEn ?? r.reasoningZh ?? r.reasoning ?? undefined
          : r.reasoningZh ?? r.reasoningEn ?? r.reasoning ?? undefined,
      hkr: effectiveHkr ?? undefined,
      // ── Event-aggregation fields ──
      clusterId: r.clusterId ?? undefined,
      coverage,
      firstSeenAt: r.clusterFirstSeenAt?.toISOString(),
      latestMemberAt: r.clusterLatestMemberAt?.toISOString(),
      canonicalTitleZh: r.clusterCanonicalTitleZh ?? undefined,
      canonicalTitleEn: r.clusterCanonicalTitleEn ?? undefined,
      stillDeveloping: stillDeveloping || undefined,
    };
  });
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
  locale: Locale = "zh",
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

