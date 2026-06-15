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
 *                         tags overlap any of these.
 *   include_source_tags = comma-separated tag list. Inverse of exclude_source_tags;
 *                         only returns items whose source tags overlap.
 *   limit            = 1..500, default 40
 *   offset           = ≥0, default 0
 *   locale           = zh | en (default en)
 */
import {
  runV1Route,
  v1InvalidQuery,
  v1Json,
  v1ServerError,
} from "@/lib/api/v1-route";
import {
  runFeedQuery,
  toAgentFeedPayload,
} from "@/lib/api/feed-results";
import {
  feedQueryFromParams,
  parseV1FeedQueryRequest,
} from "@/lib/api/feed-query-params";

export async function GET(req: Request) {
  return runV1Route(req, async () => {
    const parsed = parseV1FeedQueryRequest(req);
    if (!parsed.ok) return v1InvalidQuery(parsed.issues);

    const q = parsed.data;
    const feedQuery = feedQueryFromParams(q);

    try {
      const result = await runFeedQuery(feedQuery);
      return v1Json(toAgentFeedPayload(result, q.locale));
    } catch (err) {
      return v1ServerError("api/v1/feed", err);
    }
  });
}
