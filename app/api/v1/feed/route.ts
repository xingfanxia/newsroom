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
 * Query params are parsed by `parseV1FeedQueryRequest`. Bounds/defaults live
 * in `lib/feed/query-defaults.ts`, while enum tuples live in `lib/types.ts`.
 * Keep this route as the bearer auth + response-envelope adapter only.
 */
import {
  runV1Route,
  v1InvalidQueryResult,
  v1Json,
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
    const parsed = v1InvalidQueryResult(parseV1FeedQueryRequest(req));
    if (!parsed.ok) return parsed.response;

    const q = parsed.data;
    const feedQuery = feedQueryFromParams(q);
    const result = await runFeedQuery(feedQuery);
    return v1Json(toAgentFeedPayload(result, q.locale));
  }, { serverErrorLabel: "api/v1/feed" });
}
