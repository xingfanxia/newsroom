/**
 * Semantic search over items.embedding using pgvector HNSW.
 *
 * Flow: embed the user's query via the same Azure text-embedding-3-large
 * deployment that enriched the items, then `ORDER BY embedding <#> $q`
 * and return the top-N hits. `<#>` is negative-inner-product; for the
 * unit-length vectors OpenAI's embeddings produce, this ranks identically
 * to cosine distance (`<=>`) but skips the renormalization, saving ~15%
 * of per-query work.
 *
 * The HNSW index was created by scripts/ops/db-create-hnsw.ts and is
 * re-created automatically after every `bun run db:push` (gotcha #2 in
 * docs/HANDOFF.md).
 *
 * Known caveat: adding WHERE filters (tier/source_id/date) can force the
 * planner off the HNSW index into a seq scan. At today's 6.8k-item index
 * this is still sub-200ms, so v1 just accepts the risk and measures. If
 * it becomes a bottleneck, switch to the two-query fallback (HNSW candidate
 * set of 500, then filter in app).
 */
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { items, sources, clusters, halfvecToDriver } from "@/db/schema";
import { embed } from "@/lib/llm";
import type { Story } from "@/lib/types";

export type SemanticFilters = {
  locale?: "zh" | "en";
  limit?: number;
  sourceId?: string;
  sourceGroup?: string;
  sourceKind?: string;
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
  const queryVecText = halfvecToDriver(embedding);
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);

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
      ? sql`${items.publishedAt} >= ${opts.dateFrom ?? "1970-01-01"}::timestamptz AND ${items.publishedAt} < ${opts.dateTo ?? "2999-01-01"}::timestamptz`
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

  // `<#>` returns negative distance for unit vectors; smaller = closer.
  // We expose raw distance to the caller so they can tune a threshold.
  const distance = sql<number>`(${items.embedding} <#> ${queryVecText}::halfvec(3072))::float`;

  const rows = await db()
    .select({
      id: items.id,
      title: items.title,
      titleZh: items.titleZh,
      titleEn: items.titleEn,
      summaryZh: items.summaryZh,
      summaryEn: items.summaryEn,
      editorNoteZh: items.editorNoteZh,
      editorNoteEn: items.editorNoteEn,
      editorAnalysisZh: items.editorAnalysisZh,
      editorAnalysisEn: items.editorAnalysisEn,
      reasoning: items.reasoning,
      reasoningZh: items.reasoningZh,
      reasoningEn: items.reasoningEn,
      hkr: items.hkr,
      url: items.url,
      importance: items.importance,
      tier: items.tier,
      tags: items.tags,
      publishedAt: items.publishedAt,
      sourceId: items.sourceId,
      sourceNameZh: sources.nameZh,
      sourceNameEn: sources.nameEn,
      sourceLocale: sources.locale,
      sourceKind: sources.kind,
      sourceGroup: sources.group,
      distance,
    })
    .from(items)
    .innerJoin(sources, eq(items.sourceId, sources.id))
    .leftJoin(clusters, eq(items.clusterId, clusters.id))
    .where(
      and(
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
    .orderBy(sql`${items.embedding} <#> ${queryVecText}::halfvec(3072)`)
    .limit(limit);

  const locale = opts.locale ?? "en";

  const mapped = rows.map((r) => {
    const tagBag = (r.tags ?? {}) as {
      capabilities?: string[];
      entities?: string[];
      topics?: string[];
    };
    const flatTags = [
      ...(tagBag.capabilities ?? []),
      ...(tagBag.entities ?? []),
      ...(tagBag.topics ?? []),
    ].slice(0, 4);

    const publisher = locale === "en" ? r.sourceNameEn : r.sourceNameZh;
    const title =
      locale === "en"
        ? r.titleEn ?? r.titleZh ?? r.title
        : r.titleZh ?? r.titleEn ?? r.title;
    const editorNote =
      locale === "en"
        ? r.editorNoteEn ?? r.editorNoteZh
        : r.editorNoteZh ?? r.editorNoteEn;
    const editorAnalysis =
      locale === "en"
        ? r.editorAnalysisEn ?? r.editorAnalysisZh
        : r.editorAnalysisZh ?? r.editorAnalysisEn;

    const story: Story & { distance: number } = {
      id: String(r.id),
      sourceId: r.sourceId,
      source: {
        publisher,
        kindCode: r.sourceKind as Story["source"]["kindCode"],
        localeCode: (r.sourceLocale ?? "multi") as Story["source"]["localeCode"],
        groupCode: r.sourceGroup as Story["source"]["groupCode"],
      },
      featured: r.tier === "featured" || r.tier === "p1",
      title,
      summary:
        locale === "en"
          ? r.summaryEn ?? r.summaryZh ?? ""
          : r.summaryZh ?? r.summaryEn ?? "",
      tags: flatTags,
      importance: r.importance ?? 0,
      tier: (r.tier ?? "all") as Story["tier"],
      publishedAt: r.publishedAt.toISOString(),
      url: r.url,
      locale: (r.sourceLocale ?? "multi") as Story["locale"],
      editorNote: editorNote ?? undefined,
      editorAnalysis: editorAnalysis ?? undefined,
      reasoning:
        locale === "en"
          ? r.reasoningEn ?? r.reasoningZh ?? r.reasoning ?? undefined
          : r.reasoningZh ?? r.reasoningEn ?? r.reasoning ?? undefined,
      hkr: (r.hkr as Story["hkr"]) ?? undefined,
      distance: Number(r.distance),
    };
    return story;
  });

  return {
    items: mapped,
    total: mapped.length,
    embeddingDims: embedding.length,
  };
}
