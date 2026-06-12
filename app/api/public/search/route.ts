/**
 * GET /api/public/search — Anonymous lexical + semantic search.
 *
 * `mode=lexical` (default) — ILIKE substring against title/summary, fast + cheap.
 * `mode=semantic` — embeds q via Azure text-embedding-3-large and ranks by
 *   pgvector cosine distance. Each hit gets a `distance` field (smaller = closer).
 *
 * Same item shape and field stripping as /api/public/feed.
 */
import { getFeaturedStories } from "@/lib/items/live";
import { semanticSearch } from "@/lib/items/semantic-search";
import { publicRateLimit } from "@/lib/rate-limit/public";
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
  searchFeedQueryFromParams,
} from "@/lib/api/feed-query-params";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  // Semantic search has measurable LLM cost — tighter limit than feed.
  const limited = publicRateLimit(req, {
    family: "public-search",
    windowMs: 60_000,
    max: 120,
  });
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
    if (p.mode === "semantic") {
      const started = Date.now();
      const result = await semanticSearch(p.q, {
        locale: p.locale,
        limit: p.limit,
        sourceId: p.source_id,
        sourceGroup: p.source_group,
        sourceKind: p.source_kind,
        dateFrom: p.date_from,
        dateTo: p.date_to,
        includeExcluded: p.tier === "all",
      });
      const etag = computeEtag(
        "public-search",
        `${baseSignal}|total=${result.total}|first=${result.items[0]?.id ?? ""}`,
      );
      if (ifNoneMatch(req, etag)) return notModified(etag);
      return publicJson(
        {
          mode: "semantic",
          q: p.q,
          items: result.items.map((s) => ({
            ...toPublicApiItem(s, p.locale),
            distance: s.distance,
          })),
          total: result.total,
          limit: p.limit,
          offset: 0,
          latency_ms: Date.now() - started,
        },
        etag,
      );
    }

    const feedQuery = searchFeedQueryFromParams(p);
    const stories = await getFeaturedStories(feedQuery);
    const etag = computeEtag(
      "public-search",
      `${baseSignal}|n=${stories.length}|first=${stories[0]?.id ?? ""}`,
    );
    if (ifNoneMatch(req, etag)) return notModified(etag);
    return publicJson(
      {
        mode: p.mode,
        q: p.q,
        items: stories.map((s) => toPublicApiItem(s, p.locale)),
        total: stories.length,
        limit: p.limit,
        offset: p.offset,
      },
      etag,
    );
  } catch (err) {
    console.error("[api/public/search] failed", err);
    return publicError("server_error", 500);
  }
}
