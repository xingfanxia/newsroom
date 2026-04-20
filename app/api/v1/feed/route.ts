/**
 * GET /api/v1/feed — Bearer-gated curated feed.
 *
 * Agent-friendly flat-JSON shape with snake_case fields, ISO dates, and a
 * `total` count for pagination. Filter surface mirrors the internal
 * FeedQuery type, but uses snake_case externally (date_from, source_id, ...).
 *
 * Query params:
 *   tier         = featured (default) | p1 | all
 *   date         = YYYY-MM-DD (exclusive with date_from/date_to)
 *   date_from    = ISO-8601 (inclusive lower bound)
 *   date_to      = ISO-8601 (exclusive upper bound)
 *   source_id    = exact source id (e.g. "dwarkesh-yt")
 *   source_group = podcast | newsletter | vendor-official | …
 *   source_kind  = rss | atom | api | rsshub | scrape | x-api
 *   limit        = 1..500, default 40
 *   offset       = ≥0, default 0
 *   locale       = zh | en (default en)
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
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
    .optional(),
  date_from: z.string().datetime().optional(),
  date_to: z.string().datetime().optional(),
  source_id: z.string().min(1).optional(),
  source_group: z.string().min(1).optional(),
  source_kind: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(40),
  offset: z.coerce.number().int().min(0).optional().default(0),
  locale: z.enum(["zh", "en"]).optional().default("en"),
});

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
};

function toApiItem(s: Story): ApiItem {
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
    cross_source_count: s.crossSourceCount ?? null,
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
  };

  try {
    const [stories, total] = await Promise.all([
      getFeaturedStories(feedQuery),
      countFeaturedStories(feedQuery),
    ]);
    return Response.json({
      items: stories.map(toApiItem),
      total,
      limit: q.limit,
      offset: q.offset,
    });
  } catch (err) {
    console.error("[api/v1/feed] failed", err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
