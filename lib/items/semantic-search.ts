/**
 * Semantic search over items.embedding using libSQL native vector search.
 *
 * Flow: embed the user's query via the same Azure text-embedding-3-large
 * deployment that enriched the items, then probe the DiskANN index
 * (`vector_top_k`) for a candidate set, and rank the filtered survivors by
 * exact `vector_distance_cos`. Cosine distance = 1 − cosine similarity
 * (0 = identical, ~1 = unrelated) — the old pgvector `<#>` inner-product
 * shortcut has no libSQL equivalent, so scores changed scale in the Turso
 * migration (they remain "smaller = closer").
 *
 * The DiskANN index is created by scripts/ops/db-create-vector-index.ts and
 * must be re-created after any `bun run db:push` (same gotcha as the old
 * HNSW index — see docs/HANDOFF.md gotcha #2).
 *
 * Two-phase shape (candidates → filter) is deliberate: `vector_top_k` can't
 * see WHERE clauses, so we over-fetch candidates and filter after. If every
 * candidate gets filtered out the result is thin — same class of caveat the
 * pgvector version had when the planner fell off the HNSW index. At ~21k
 * items a TOP_K_CANDIDATES probe is a few thousand row reads, still cheap.
 */
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, libsqlClient } from "@/db/client";
import { items, sources, clusters, embeddingToVectorText } from "@/db/schema";
import { storySelectFields } from "@/lib/items/story-select";
import { toStory } from "@/lib/items/story-mapper";
import { embed } from "@/lib/llm";
import {
  DEFAULT_API_SEARCH_LOCALE,
  DEFAULT_SEARCH_LIMIT,
  MCP_SEARCH_LIMIT_MAX,
  SEARCH_LIMIT_MIN,
} from "@/lib/search/query-defaults";
import {
  type AppLocale,
  type SourceGroup,
  type SourceKind,
  type Story,
} from "@/lib/types";

/** Candidate pool fetched from the vector index before SQL filters run.
 *  Matches the "HNSW candidate set of 500, then filter" fallback the
 *  pgvector version documented. */
const TOP_K_CANDIDATES = 500;

export type SemanticFilters = {
  locale?: AppLocale;
  limit?: number;
  sourceId?: string;
  sourceGroup?: SourceGroup;
  sourceKind?: SourceKind;
  dateFrom?: string;
  dateTo?: string;
  /** Include excluded-tier hits? Default false — matches /feed behavior. */
  includeExcluded?: boolean;
};

export type SemanticResult = {
  items: Array<Story & { distance: number }>;
  total: number;
  embeddingDims: number;
};

export async function semanticSearch(
  queryText: string,
  opts: SemanticFilters = {},
): Promise<SemanticResult> {
  const trimmed = queryText.trim();
  if (!trimmed) {
    return { items: [], total: 0, embeddingDims: 0 };
  }

  const { embedding } = await embed({ value: trimmed, task: "search" });
  const queryVecText = embeddingToVectorText(embedding);
  const limit = Math.min(
    Math.max(opts.limit ?? DEFAULT_SEARCH_LIMIT, SEARCH_LIMIT_MIN),
    MCP_SEARCH_LIMIT_MAX,
  );

  // Phase 1 — DiskANN probe for the nearest candidate ids.
  const topK = await libsqlClient().execute({
    sql: "SELECT id FROM vector_top_k('items_embedding_idx', vector32(?), ?)",
    args: [queryVecText, TOP_K_CANDIDATES],
  });
  const candidateIds = topK.rows.map((r) => Number(r.id));
  if (candidateIds.length === 0) {
    return { items: [], total: 0, embeddingDims: embedding.length };
  }

  const sourceIdFilter = opts.sourceId
    ? sql`${items.sourceId} = ${opts.sourceId}`
    : sql`TRUE`;
  const groupFilter = opts.sourceGroup
    ? sql`${sources.group} = ${opts.sourceGroup}`
    : sql`TRUE`;
  const kindFilter = opts.sourceKind
    ? sql`${sources.kind} = ${opts.sourceKind}`
    : sql`TRUE`;
  const dateFilter =
    opts.dateFrom || opts.dateTo
      ? sql`${items.publishedAt} >= ${Date.parse(opts.dateFrom ?? "1970-01-01")} AND ${items.publishedAt} < ${Date.parse(opts.dateTo ?? "2999-01-01")}`
      : sql`TRUE`;
  const exclusionFilter = opts.includeExcluded
    ? sql`TRUE`
    : sql`COALESCE(${clusters.eventTier}, ${items.tier}) <> 'excluded'`;

  // Event-aware dedup — parallel to lib/items/live.ts. Singletons (no cluster
  // row) pass through; multi-member clusters return only their lead item so
  // search results don't spam the same event in N locales. Downside: if the
  // query's nearest vector match is a non-lead member, it's hidden — but the
  // lead is always indexed too and usually ranks close enough.
  const dedupFilter = sql`(${items.clusterId} IS NULL OR ${clusters.leadItemId} = ${items.id})`;

  // Phase 2 — exact cosine distance over the candidate set, post-filters.
  const distance = sql<number>`vector_distance_cos(${items.embedding}, vector32(${queryVecText}))`;

  const rows = await db()
    .select({
      ...storySelectFields,
      distance,
    })
    .from(items)
    .innerJoin(sources, eq(items.sourceId, sources.id))
    .leftJoin(clusters, eq(items.clusterId, clusters.id))
    .where(
      and(
        inArray(items.id, candidateIds),
        isNotNull(items.embedding),
        isNotNull(items.enrichedAt),
        exclusionFilter,
        dedupFilter,
        sourceIdFilter,
        groupFilter,
        kindFilter,
        dateFilter,
      ),
    )
    .orderBy(distance)
    .limit(limit);

  const locale = opts.locale ?? DEFAULT_API_SEARCH_LOCALE;

  const mapped = rows.map((r) => {
    return {
      ...toStory(r, {
        locale,
        tagLimit: 4,
        includeSourceGroup: true,
      }),
      distance: Number(r.distance),
    } satisfies Story & { distance: number };
  });

  return {
    items: mapped,
    total: mapped.length,
    embeddingDims: embedding.length,
  };
}
