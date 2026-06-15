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
  publicCachedRoute,
  publicInvalidQueryResult,
} from "@/lib/api/public-helpers";
import { parsePublicSearchQueryRequest } from "@/lib/api/feed-query-params";
import {
  runSearchQuery,
  toPublicSearchPayload,
} from "@/lib/api/search-results";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  return publicCachedRoute(req, {
    endpoint: "search",
    etagFamily: "public-search",
    label: "api/public/search",
    load: async () => {
      const parsed = parsePublicSearchQueryRequest(req);
      if (!parsed.ok) return publicInvalidQueryResult(parsed.issues);
      const p = parsed.data;

      // ETag binds to query — same q + filters produces stable etag while
      // corpus doesn't grow new matches.
      const baseSignal = etagSignal({
        qs: parsed.search,
        mode: p.mode,
      });
      const result = await runSearchQuery(p);

      return {
        ok: true,
        signal: `${baseSignal}|total=${result.total}|first=${result.items[0]?.id ?? ""}`,
        body: toPublicSearchPayload(result, p.locale),
      };
    },
  });
}
