/**
 * GET /api/public/search — Anonymous lexical + semantic search.
 *
 * `mode=lexical` (default) — ILIKE substring against title/summary, fast + cheap.
 * `mode=semantic` — embeds q via Azure text-embedding-3-large and ranks by
 *   pgvector cosine distance. Each hit gets a `distance` field (smaller = closer).
 *
 * Same field stripping as /api/public/feed.
 */
import { z } from "zod";
import {
  getFeaturedStories,
  type FeedQuery,
} from "@/lib/items/live";
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
import type { Story } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const querySchema = z.object({
  q: z.string().min(1, "q is required"),
  mode: z.enum(["lexical", "semantic"]).optional().default("lexical"),
  tier: z.enum(["featured", "p1", "all"]).optional().default("all"),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
    .optional(),
  date_from: z.string().datetime().optional(),
  date_to: z.string().datetime().optional(),
  source_id: z.string().min(1).optional(),
  source_group: z.string().min(1).optional(),
  source_kind: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
  locale: z.enum(["zh", "en"]).optional().default("en"),
});

function toPublicItem(s: Story, locale: "zh" | "en") {
  const isEvent = (s.coverage ?? 0) > 1 && s.clusterId != null;
  return {
    id: s.id,
    title: s.title,
    summary: s.summary,
    publisher: s.source.publisher,
    source_id: s.sourceId,
    source_group: s.source.groupCode ?? null,
    source_kind: s.source.kindCode,
    tier: s.tier,
    importance: s.importance,
    hkr: s.hkr ? { h: s.hkr.h, k: s.hkr.k, r: s.hkr.r } : null,
    tags: s.tags,
    url: s.url,
    published_at: s.publishedAt,
    cluster_id: s.clusterId ?? null,
    coverage: s.coverage ?? null,
    canonical_title: isEvent
      ? (locale === "zh" ? s.canonicalTitleZh : s.canonicalTitleEn) ?? null
      : null,
  };
}

export async function GET(req: Request) {
  // Semantic search has measurable LLM cost — tighter limit than feed.
  const limited = publicRateLimit(req, {
    family: "public-search",
    windowMs: 60_000,
    max: 120,
  });
  if (limited) return limited;

  const url = new URL(req.url);
  const parsed = querySchema.safeParse(
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
            ...toPublicItem(s, p.locale),
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

    const feedQuery: FeedQuery = {
      tier: p.tier,
      locale: p.locale,
      limit: p.limit,
      offset: p.offset,
      sourceId: p.source_id,
      sourceGroup: p.source_group,
      sourceKind: p.source_kind,
      date: p.date,
      dateFrom: p.date_from,
      dateTo: p.date_to,
      includeSourceGroup: true,
      searchText: p.q,
    };
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
        items: stories.map((s) => toPublicItem(s, p.locale)),
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
