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
};

/**
 * Build the shared WHERE expression used by both getFeaturedStories and
 * countFeaturedStories so pagination totals can't drift from the
 * actually-returned rows.
 */
function buildFeedWhere(q: FeedQuery) {
  const tier: Tier = q.tier ?? "featured";

  // Tiers are inclusive: "featured" shows featured+p1; "all" shows everything non-excluded.
  const tierFilter =
    tier === "p1"
      ? sql`${items.tier} = 'p1'`
      : tier === "featured"
        ? sql`${items.tier} IN ('featured', 'p1')`
        : sql`${items.tier} <> 'excluded'`;

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
  // Day filter: published_at falls within [date 00:00 UTC, date+1 00:00 UTC).
  // Explicit ::timestamptz on both ends so postgres doesn't reject the param
  // binding (same pattern as dashboard-stats).
  const dateFilter = q.date
    ? sql`${items.publishedAt} >= ${`${q.date}T00:00:00Z`}::timestamptz AND ${items.publishedAt} < ${`${q.date}T00:00:00Z`}::timestamptz + interval '1 day'`
    : q.dateFrom || q.dateTo
      ? sql`${items.publishedAt} >= ${q.dateFrom ?? "1970-01-01"}::timestamptz AND ${items.publishedAt} < ${q.dateTo ?? "2999-01-01"}::timestamptz`
      : sql`TRUE`;

  const searchFilter = q.searchText
    ? sql`(
        ${items.title} ILIKE ${`%${q.searchText}%`} OR
        ${items.titleZh} ILIKE ${`%${q.searchText}%`} OR
        ${items.titleEn} ILIKE ${`%${q.searchText}%`} OR
        ${items.summaryZh} ILIKE ${`%${q.searchText}%`} OR
        ${items.summaryEn} ILIKE ${`%${q.searchText}%`}
      )`
    : sql`TRUE`;

  const curatedFilter = q.curatedOnly
    ? sql`${sources.curated} = TRUE`
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
      clusterMemberCount: clusters.memberCount,
    })
    .from(items)
    .innerJoin(sources, eq(items.sourceId, sources.id))
    .leftJoin(clusters, eq(items.clusterId, clusters.id))
    .where(buildFeedWhere(q))
    .orderBy(desc(items.publishedAt))
    .limit(limit)
    .offset(offset);

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

    // Title fallback ladder: prefer LLM-translated locale match, fall back to
    // the other locale, fall back to the raw source title.
    const title =
      q.locale === "en"
        ? r.titleEn ?? r.titleZh ?? r.title
        : r.titleZh ?? r.titleEn ?? r.title;

    const editorNote =
      q.locale === "en"
        ? r.editorNoteEn ?? r.editorNoteZh
        : r.editorNoteZh ?? r.editorNoteEn;
    const editorAnalysis =
      q.locale === "en"
        ? r.editorAnalysisEn ?? r.editorAnalysisZh
        : r.editorAnalysisZh ?? r.editorAnalysisEn;

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
      featured: r.tier === "featured" || r.tier === "p1",
      title,
      summary:
        q.locale === "en"
          ? r.summaryEn ?? r.summaryZh ?? ""
          : r.summaryZh ?? r.summaryEn ?? "",
      tags: flatTags,
      importance: r.importance ?? 0,
      tier: (r.tier ?? "all") as Story["tier"],
      publishedAt: r.publishedAt.toISOString(),
      url: r.url,
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
      hkr: (r.hkr as Story["hkr"]) ?? undefined,
    };
  });
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

