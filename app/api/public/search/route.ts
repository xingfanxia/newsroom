/**
 * GET /api/public/search — Anonymous lexical + semantic search.
 *
 * `mode=lexical` (default) — ILIKE substring against title/summary, fast + cheap.
 * `mode=semantic` — embeds q via Azure text-embedding-3-large and ranks by
 *   pgvector cosine distance. Each hit gets a `distance` field (smaller = closer).
 *
 * Same item shape and field stripping as /api/public/feed.
 */
import { publicRateLimit } from "@/lib/rate-limit/public";
import { publicRateLimitConfig } from "@/lib/rate-limit/public-config";
import {
  computeEtag,
  etagSignal,
  ifNoneMatch,
  notModified,
  publicError,
  publicJson,
} from "@/lib/api/public-helpers";
import { toPublicApiItem } from "@/lib/api/public-items";
import {
  publicSearchQueryParamSchema,
} from "@/lib/api/feed-query-params";
import { runSearchQuery } from "@/lib/api/search-results";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  // Semantic search has measurable LLM cost — tighter limit than feed.
  const limited = publicRateLimit(req, publicRateLimitConfig("search"));
  if (limited) return limited;

  const url = new URL(req.url);
  const parsed = publicSearchQueryParamSchema.safeParse(
    Object.fromEntries(url.searchParams.entries()),
  );
  if (!parsed.success) {
    return publicError(
      `invalid_query: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      400,
    );
  }
  const p = parsed.data;

  // ETag binds to query — same q + filters produces stable etag while corpus
  // doesn't grow new matches.
  const baseSignal = etagSignal({
    qs: url.search,
    mode: p.mode,
  });

  try {
    const result = await runSearchQuery(p);
    if (result.mode === "semantic") {
      const etag = computeEtag(
        "public-search",
        `${baseSignal}|total=${result.total}|first=${result.items[0]?.id ?? ""}`,
      );
      if (ifNoneMatch(req, etag)) return notModified(etag);
      return publicJson(
        {
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
        etag,
      );
    }

    const etag = computeEtag(
      "public-search",
      `${baseSignal}|total=${result.total}|first=${result.items[0]?.id ?? ""}`,
    );
    if (ifNoneMatch(req, etag)) return notModified(etag);
    return publicJson(
      {
        mode: result.mode,
        q: result.q,
        items: result.items.map((s) => toPublicApiItem(s, p.locale)),
        total: result.total,
        limit: result.limit,
        offset: result.offset,
      },
      etag,
    );
  } catch (err) {
    console.error("[api/public/search] failed", err);
    return publicError("server_error", 500);
  }
}
