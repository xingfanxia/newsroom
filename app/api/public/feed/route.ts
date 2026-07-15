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
import { publicCachedRoute } from "@/lib/api/public-helpers";
import { publicFeedSnapshotRequestResult } from "@/lib/public-content/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  return publicCachedRoute(req, {
    endpoint: "feed",
    etagFamily: "public-feed",
    label: "api/public/feed",
    load: async () => publicFeedSnapshotRequestResult(req),
  });
}
