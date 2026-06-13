/**
 * GET /api/public/feed — Anonymous, ETag-aware, rate-limited.
 *
 * Same shape as /api/v1/feed but:
 *   - no Bearer required
 *   - IP rate limit
 *   - weak ETag + If-None-Match → 304 for cron pollers
 *   - CORS-open so browsers + agents can hit directly
 *   - strips LLM internal fields (reasoning, hkr.reasonsZh/En) — keeps everything
 *     a human can already see on the site (importance, hkr booleans, tier, coverage, ...)
 *
 * Query surface mirrors /api/v1/feed:
 *   tier / view / hot_window_hours / date{,_from,_to} / source_{id,group,kind}
 *   curated_only / include_source_tags / exclude_source_tags / limit / offset / locale
 */
import { publicRateLimit } from "@/lib/rate-limit/public";
import {
  publicCacheConfig,
  publicRateLimitConfig,
} from "@/lib/api/public-endpoint-config";
import {
  computeEtag,
  etagSignal,
  ifNoneMatch,
  notModified,
  publicError,
  publicJson,
} from "@/lib/api/public-helpers";
import { runFeedQuery } from "@/lib/api/feed-results";
import { toPublicApiItem } from "@/lib/api/public-items";
import {
  feedQueryFromParams,
  publicFeedQueryParamSchema,
} from "@/lib/api/feed-query-params";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const limited = publicRateLimit(req, publicRateLimitConfig("feed"));
  if (limited) return limited;

  const url = new URL(req.url);
  const params = Object.fromEntries(url.searchParams.entries());
  const parsed = publicFeedQueryParamSchema.safeParse(params);
  if (!parsed.success) {
    return publicError(
      `invalid_query: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      400,
    );
  }
  const q = parsed.data;
  const feedQuery = feedQueryFromParams(q);

  try {
    const result = await runFeedQuery(feedQuery);

    const etag = computeEtag(
      "public-feed",
      etagSignal({
        count: result.items.length,
        total: result.total,
        first_id: result.items[0]?.id ?? "",
        latest_at: result.items[0]?.publishedAt ?? "",
        qs: url.search,
      }),
    );
    if (ifNoneMatch(req, etag)) return notModified(etag);

    return publicJson(
      {
        items: result.items.map((s) => toPublicApiItem(s, q.locale)),
        total: result.total,
        limit: result.limit,
        offset: result.offset,
        view: result.view,
      },
      etag,
      publicCacheConfig("feed"),
    );
  } catch (err) {
    console.error("[api/public/feed] failed", err);
    return publicError("server_error", 500);
  }
}
