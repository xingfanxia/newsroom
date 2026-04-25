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
import { z } from "zod";
import { requireApiToken } from "@/lib/auth/api-token";
import {
  countFeaturedStories,
  getFeaturedStories,
  type FeedQuery,
} from "@/lib/items/live";
import { semanticSearch } from "@/lib/items/semantic-search";
import type { Story } from "@/lib/types";

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
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
  locale: z.enum(["zh", "en"]).optional().default("en"),
});

function toApiItem(s: Story, locale: "zh" | "en") {
  const isEvent = (s.coverage ?? 0) > 1 && s.clusterId != null;
  const canonical = isEvent
    ? (locale === "zh" ? s.canonicalTitleZh : s.canonicalTitleEn) ?? null
    : null;
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
    hkr: s.hkr ?? null,
    tags: s.tags,
    url: s.url,
    published_at: s.publishedAt,
    has_commentary: Boolean(s.editorNote || s.editorAnalysis),
    cluster_id: s.clusterId ?? null,
    coverage: s.coverage ?? null,
    canonical_title: canonical,
  };
}

export async function GET(req: Request) {
  const auth = await requireApiToken(req);
  if (auth instanceof Response) return auth;

  const url = new URL(req.url);
  const params = Object.fromEntries(url.searchParams.entries());
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_query", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const p = parsed.data;

  if (p.mode === "semantic") {
    try {
      const started = Date.now();
      const result = await semanticSearch(p.q, {
        locale: p.locale,
        limit: p.limit,
        sourceId: p.source_id,
        sourceGroup: p.source_group,
        sourceKind: p.source_kind,
        dateFrom: p.date_from,
        dateTo: p.date_to,
        // Semantic search defaults to spanning everything, including
        // excluded-tier items, because intent often conflicts with
        // curator heuristics (an "excluded" interview can be exactly
        // what the agent is hunting for).
        includeExcluded: p.tier === "all",
      });
      return Response.json({
        mode: "semantic",
        q: p.q,
        items: result.items.map((s) => ({
          ...toApiItem(s, p.locale),
          distance: s.distance,
        })),
        total: result.total,
        limit: p.limit,
        offset: 0,
        embedding_dims: result.embeddingDims,
        latency_ms: Date.now() - started,
      });
    } catch (err) {
      console.error("[api/v1/search semantic] failed", err);
      return Response.json({ error: "server_error" }, { status: 500 });
    }
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

  try {
    const [stories, total] = await Promise.all([
      getFeaturedStories(feedQuery),
      countFeaturedStories(feedQuery),
    ]);
    return Response.json({
      mode: p.mode,
      q: p.q,
      items: stories.map((s) => toApiItem(s, p.locale)),
      total,
      limit: p.limit,
      offset: p.offset,
    });
  } catch (err) {
    console.error("[api/v1/search] failed", err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
