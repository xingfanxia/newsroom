/**
 * GET /api/v1/search — Bearer-gated search across enriched items.
 *
 *   mode=lexical: case-insensitive ILIKE against title + both-locale
 *   title/summary columns. Fast, cheap, exact substring matches only.
 *
 *   mode=semantic: embeds the query via Azure text-embedding-3-large (one call
 *   per request, ~$0.00002) and ranks items by pgvector cosine distance on the
 *   HNSW-indexed embedding column. Finds conceptual matches ("agentic coding"
 *   returns items about autonomous IDE agents even if the exact phrase is
 *   absent). Returns each hit with a `distance` field the agent can use to
 *   threshold results (smaller = closer; for unit vectors -1 is identical).
 *
 * Response shape matches /api/v1/feed so agents can reuse their item parser.
 *
 * Query params are parsed by `parseV1SearchQueryRequest`. Bounds/defaults live
 * in `lib/search/query-defaults.ts`, while shared feed/search filter tuples
 * live in `lib/types.ts`. Keep this route as the bearer auth +
 * response-envelope adapter only.
 */
import {
  runV1Route,
  v1InvalidQueryResult,
  v1Json,
} from "@/lib/api/v1-route";
import { parseV1SearchQueryRequest } from "@/lib/api/feed-query-params";
import {
  runSearchQuery,
  toAgentSearchPayload,
} from "@/lib/api/search-results";

export async function GET(req: Request) {
  return runV1Route(req, async () => {
    const parsed = v1InvalidQueryResult(parseV1SearchQueryRequest(req));
    if (!parsed.ok) return parsed.response;

    const p = parsed.data;
    const result = await runSearchQuery(p);
    return v1Json(toAgentSearchPayload(result, p.locale));
  }, { serverErrorLabel: "api/v1/search" });
}
