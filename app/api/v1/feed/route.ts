/**
 * GET /api/v1/feed — Bearer-gated curated feed.
 *
 * Agent-friendly flat-JSON shape with snake_case fields, ISO dates, and a
 * `total` count for pagination. Filter surface mirrors the internal
 * FeedQuery type, but uses snake_case externally (date_from, source_id, ...).
 *
 * Multi-source events: when an item is part of a multi-member cluster (an
 * "event" — same real-world story covered by multiple publishers), the
 * response includes `cluster_id`, `coverage`, `canonical_title`, etc. Hit
 * GET /api/v1/events/:cluster_id/members for the full cross-source list.
 * Singleton items (no cluster or member_count=1) leave these fields null.
 *
 * Query params:
 *   tier             = featured (default) | p1 | all
 *   view             = today (trending: importance-sorted, ongoing+broken-today)
 *                    | archive (default; chronological, published_at anchor)
 *   hot_window_hours = 1..168, default 24 — only matters for view=today
 *   date             = YYYY-MM-DD (exclusive with date_from/date_to)
 *   date_from        = ISO-8601 (inclusive lower bound)
 *   date_to          = ISO-8601 (exclusive upper bound)
 *   source_id        = exact source id (e.g. "dwarkesh-yt")
 *   source_group     = podcast | newsletter | vendor-official | …
 *   source_kind      = rss | atom | api | rsshub | scrape | x-api
 *   curated_only     = true → only sources flagged curated=true (AX严选 tab)
 *   exclude_source_tags = comma-separated tag list. Excludes sources whose
 *                         tags overlap any of these. Useful: "arxiv,paper" to
 *                         filter out research-paper feeds.
 *   include_source_tags = comma-separated tag list. Inverse of exclude_source_tags;
 *                         only returns items whose source tags overlap. Useful:
 *                         "arxiv,paper" to fetch the 论文 tab.
 *   limit            = 1..500, default 40
 *   offset           = ≥0, default 0
 *   locale           = zh | en (default en)
 */
import { z } from "zod";
import { requireApiToken } from "@/lib/auth/api-token";
import {
  countFeaturedStories,
  getFeaturedStories,
  type FeedQuery,
} from "@/lib/items/live";
import type { Story } from "@/lib/types";

const querySchema = z.object({
  tier: z.enum(["featured", "p1", "all"]).optional().default("featured"),
  view: z.enum(["today", "archive"]).optional().default("archive"),
  hot_window_hours: z.coerce
    .number()
    .int()
    .min(1)
    .max(168)
    .optional()
    .default(24),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
    .optional(),
  date_from: z.string().datetime().optional(),
  date_to: z.string().datetime().optional(),
  source_id: z.string().min(1).optional(),
  source_group: z.string().min(1).optional(),
  source_kind: z.string().min(1).optional(),
  curated_only: z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((v) => v === "true" || v === "1"),
  exclude_source_tags: z.string().min(1).optional(),
  include_source_tags: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(40),
  offset: z.coerce.number().int().min(0).optional().default(0),
  locale: z.enum(["zh", "en"]).optional().default("en"),
});

function parseTagList(s: string | undefined): string[] | undefined {
  if (!s) return undefined;
  const tags = s
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return tags.length > 0 ? tags : undefined;
}

type ApiItem = {
  id: string;
  title: string;
  summary: string;
  publisher: string;
  source_id: string;
  source_group: string | null;
  source_kind: string;
  tier: Story["tier"];
  importance: number;
  hkr: Story["hkr"] | null;
  tags: string[];
  url: string;
  published_at: string;
  has_commentary: boolean;
  cross_source_count: number | null;
  // ── Event aggregation (null for singletons) ──
  /** clusters.id — pass to GET /api/v1/events/:id/members for cross-source list. */
  cluster_id: number | null;
  /** member_count — number of sources covering this event. 1 = singleton. */
  coverage: number | null;
  /** Neutral canonical event name in the requested locale. Falls back null for singletons. */
  canonical_title: string | null;
  /** ISO — first time any source covered this event (event inception). */
  first_seen_at: string | null;
  /** ISO — most recent member join (today-view recency anchor). */
  latest_member_at: string | null;
  /** True iff first_seen_at < today AND latest_member_at within hot_window_hours. */
  still_developing: boolean | null;
};

function toApiItem(s: Story, locale: "zh" | "en"): ApiItem {
  const isEvent = (s.coverage ?? 0) > 1 && s.clusterId != null;
  const canonical = isEvent
    ? (locale === "zh" ? s.canonicalTitleZh : s.canonicalTitleEn) ?? null
    : null;
  return {
    id: s.id,
    title: s.title,
    summary: s.summary,
    publisher: s.source.publisher,
    source_id: s.sourceId,
    source_group: s.source.groupCode ?? null,
    source_kind: s.source.kindCode,
    tier: s.tier,
    importance: s.importance,
    hkr: s.hkr ?? null,
    tags: s.tags,
    url: s.url,
    published_at: s.publishedAt,
    has_commentary: Boolean(s.editorNote || s.editorAnalysis),
    cross_source_count: s.crossSourceCount ?? s.coverage ?? null,
    cluster_id: s.clusterId ?? null,
    coverage: s.coverage ?? null,
    canonical_title: canonical,
    first_seen_at: s.firstSeenAt ?? null,
    latest_member_at: s.latestMemberAt ?? null,
    still_developing: s.stillDeveloping ?? null,
  };
}

export async function GET(req: Request) {
  const auth = await requireApiToken(req);
  if (auth instanceof Response) return auth;

  const url = new URL(req.url);
  const params = Object.fromEntries(url.searchParams.entries());
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_query", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const q = parsed.data;

  const feedQuery: FeedQuery = {
    tier: q.tier,
    locale: q.locale,
    limit: q.limit,
    offset: q.offset,
    sourceId: q.source_id,
    sourceGroup: q.source_group,
    sourceKind: q.source_kind,
    date: q.date,
    dateFrom: q.date_from,
    dateTo: q.date_to,
    includeSourceGroup: true,
    view: q.view,
    hotWindowHours: q.hot_window_hours,
    curatedOnly: q.curated_only || undefined,
    excludeSourceTags: parseTagList(q.exclude_source_tags),
    includeSourceTags: parseTagList(q.include_source_tags),
  };

  try {
    const [stories, total] = await Promise.all([
      getFeaturedStories(feedQuery),
      countFeaturedStories(feedQuery),
    ]);
    return Response.json({
      items: stories.map((s) => toApiItem(s, q.locale)),
      total,
      limit: q.limit,
      offset: q.offset,
      view: q.view,
    });
  } catch (err) {
    console.error("[api/v1/feed] failed", err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
