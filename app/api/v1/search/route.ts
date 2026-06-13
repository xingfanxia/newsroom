/**
 * GET /api/v1/search — Bearer-gated search across enriched items.
 *
 *   mode=lexical (default): case-insensitive ILIKE against title + both-locale
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
 * Query params:
 *   q            = free-text (required, non-empty)
 *   mode         = lexical (default) | semantic
 *   tier         = featured | p1 | all (default all — search should span)
 *   date / date_from / date_to / source_id / source_group / source_kind
 *   limit        = 1..100, default 20
 *   offset       = ≥0, default 0 (lexical only — semantic doesn't paginate)
 *   locale       = zh | en (default en)
 */
import {
  runV1Route,
  v1Error,
  v1InvalidQuery,
  v1Json,
} from "@/lib/api/v1-route";
import { parseQueryParams } from "@/lib/api/query-params";
import { toAgentApiItem } from "@/lib/api/v1-items";
import { v1SearchQueryParamSchema } from "@/lib/api/feed-query-params";
import { runSearchQuery } from "@/lib/api/search-results";

export async function GET(req: Request) {
  return runV1Route(req, async () => {
    const parsed = parseQueryParams(req, v1SearchQueryParamSchema);
    if (!parsed.ok) return v1InvalidQuery(parsed.issues);

    const p = parsed.data;

    try {
      const result = await runSearchQuery(p);
      if (result.mode === "semantic") {
        return v1Json({
          mode: "semantic",
          q: result.q,
          items: result.items.map((s) => ({
            ...toAgentApiItem(s, p.locale),
            distance: s.distance,
          })),
          total: result.total,
          limit: result.limit,
          offset: result.offset,
          embedding_dims: result.embeddingDims,
          latency_ms: result.latencyMs,
        });
      }

      return v1Json({
        mode: result.mode,
        q: result.q,
        items: result.items.map((s) => toAgentApiItem(s, p.locale)),
        total: result.total,
        limit: result.limit,
        offset: result.offset,
      });
    } catch (err) {
      console.error("[api/v1/search] failed", err);
      return v1Error("server_error", 500);
    }
  });
}
