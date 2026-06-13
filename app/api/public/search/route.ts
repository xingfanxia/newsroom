/**
 * GET /api/public/search — Anonymous lexical + semantic search.
 *
 * `mode=lexical` (default) — ILIKE substring against title/summary, fast + cheap.
 * `mode=semantic` — embeds q via Azure text-embedding-3-large and ranks by
 *   pgvector cosine distance. Each hit gets a `distance` field (smaller = closer).
 *
 * Same item shape and field stripping as /api/public/feed.
 */
import {
  etagSignal,
  publicCachedJson,
  publicEndpointRateLimit,
  publicInvalidQuery,
  publicServerError,
} from "@/lib/api/public-helpers";
import { parseQueryParams } from "@/lib/api/query-params";
import { toPublicApiItem } from "@/lib/api/public-items";
import { publicSearchQueryParamSchema } from "@/lib/api/feed-query-params";
import { runSearchQuery } from "@/lib/api/search-results";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  // Semantic search has measurable LLM cost — tighter limit than feed.
  const limited = publicEndpointRateLimit(req, "search");
  if (limited) return limited;

  const url = new URL(req.url);
  const parsed = parseQueryParams(url, publicSearchQueryParamSchema);
  if (!parsed.ok) return publicInvalidQuery(parsed.issues);
  const p = parsed.data;

  // ETag binds to query — same q + filters produces stable etag while corpus
  // doesn't grow new matches.
  const baseSignal = etagSignal({
    qs: url.search,
    mode: p.mode,
  });

  try {
    const result = await runSearchQuery(p);
    const signal = `${baseSignal}|total=${result.total}|first=${result.items[0]?.id ?? ""}`;
    if (result.mode === "semantic") {
      return publicCachedJson(req, {
        endpoint: "search",
        etagFamily: "public-search",
        signal,
        body: {
          mode: "semantic",
          q: result.q,
          items: result.items.map((s) => ({
            ...toPublicApiItem(s, p.locale),
            distance: s.distance,
          })),
          total: result.total,
          limit: result.limit,
          offset: result.offset,
          latency_ms: result.latencyMs,
        },
      });
    }

    return publicCachedJson(req, {
      endpoint: "search",
      etagFamily: "public-search",
      signal,
      body: {
        mode: result.mode,
        q: result.q,
        items: result.items.map((s) => toPublicApiItem(s, p.locale)),
        total: result.total,
        limit: result.limit,
        offset: result.offset,
      },
    });
  } catch (err) {
    return publicServerError("api/public/search", err);
  }
}
