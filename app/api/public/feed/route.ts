/**
 * GET /api/public/feed — Anonymous, ETag-aware, rate-limited.
 *
 * Same shape as /api/v1/feed but:
 *   - no Bearer required
 *   - IP rate limit (600r/min/IP)
 *   - weak ETag + If-None-Match → 304 for cron pollers
 *   - CORS-open so browsers + agents can hit directly
 *   - strips LLM internal fields (reasoning, hkr.reasonsZh/En) — keeps everything
 *     a human can already see on the site (importance, hkr booleans, tier, coverage, ...)
 *
 * Query surface mirrors /api/v1/feed:
 *   tier / view / hot_window_hours / date{,_from,_to} / source_{id,group,kind}
 *   curated_only / include_source_tags / exclude_source_tags / limit / offset / locale
 */
import { z } from "zod";
import {
  countFeaturedStories,
  getFeaturedStories,
  type FeedQuery,
} from "@/lib/items/live";
import { publicRateLimit } from "@/lib/rate-limit/public";
import {
  computeEtag,
  etagSignal,
  ifNoneMatch,
  notModified,
  publicError,
  publicJson,
} from "@/lib/api/public-helpers";
import { toPublicApiItem } from "@/lib/api/public-items";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
  limit: z.coerce.number().int().min(1).max(100).optional().default(40),
  offset: z.coerce.number().int().min(0).optional().default(0),
  locale: z.enum(["zh", "en"]).optional().default("en"),
});

function parseTagList(s: string | undefined): string[] | undefined {
  if (!s) return undefined;
  const tags = s.split(",").map((t) => t.trim()).filter(Boolean);
  return tags.length > 0 ? tags : undefined;
}

export async function GET(req: Request) {
  const limited = publicRateLimit(req, {
    family: "public-feed",
    windowMs: 60_000,
    max: 600,
  });
  if (limited) return limited;

  const url = new URL(req.url);
  const params = Object.fromEntries(url.searchParams.entries());
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) {
    return publicError(
      `invalid_query: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      400,
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

    const etag = computeEtag(
      "public-feed",
      etagSignal({
        count: stories.length,
        total,
        first_id: stories[0]?.id ?? "",
        latest_at: stories[0]?.publishedAt ?? "",
        qs: url.search,
      }),
    );
    if (ifNoneMatch(req, etag)) return notModified(etag);

    return publicJson(
      {
        items: stories.map((s) => toPublicApiItem(s, q.locale)),
        total,
        limit: q.limit,
        offset: q.offset,
        view: q.view,
      },
      etag,
    );
  } catch (err) {
    console.error("[api/public/feed] failed", err);
    return publicError("server_error", 500);
  }
}
