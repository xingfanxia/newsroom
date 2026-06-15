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
import {
  etagSignal,
  publicCachedRoute,
  publicInvalidQueryResult,
} from "@/lib/api/public-helpers";
import {
  runFeedQuery,
  toPublicFeedPayload,
} from "@/lib/api/feed-results";
import {
  feedQueryFromParams,
  parsePublicFeedQueryRequest,
} from "@/lib/api/feed-query-params";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  return publicCachedRoute(req, {
    endpoint: "feed",
    etagFamily: "public-feed",
    label: "api/public/feed",
    load: async () => {
      const parsed = parsePublicFeedQueryRequest(req);
      if (!parsed.ok) return publicInvalidQueryResult(parsed.issues);
      const q = parsed.data;
      const feedQuery = feedQueryFromParams(q);
      const result = await runFeedQuery(feedQuery);

      return {
        ok: true,
        signal: etagSignal({
          count: result.items.length,
          total: result.total,
          first_id: result.items[0]?.id ?? "",
          latest_at: result.items[0]?.publishedAt ?? "",
          qs: parsed.search,
        }),
        body: toPublicFeedPayload(result, q.locale),
      };
    },
  });
}
