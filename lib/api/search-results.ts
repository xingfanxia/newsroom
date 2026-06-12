import {
  countFeaturedStories,
  getFeaturedStories,
} from "@/lib/items/live";
import { semanticSearch } from "@/lib/items/semantic-search";
import {
  searchFeedQueryFromParams,
  type SearchQueryParams,
} from "@/lib/api/feed-query-params";
import type { Story } from "@/lib/types";

type SemanticStory = Story & { distance: number };

export type SearchExecutionResult =
  | {
      mode: "lexical";
      q: string;
      items: Story[];
      total: number;
      limit: number;
      offset: number;
    }
  | {
      mode: "semantic";
      q: string;
      items: SemanticStory[];
      total: number;
      limit: number;
      offset: 0;
      embeddingDims: number;
      latencyMs: number;
    };

/**
 * Shared execution for /api/v1/search and /api/public/search.
 * Route handlers own auth/rate-limit/serialization; this module owns the
 * search semantics so lexical totals and semantic filters cannot drift.
 */
export async function runSearchQuery(
  params: SearchQueryParams,
): Promise<SearchExecutionResult> {
  if (params.mode === "semantic") {
    const started = Date.now();
    const result = await semanticSearch(params.q, {
      locale: params.locale,
      limit: params.limit,
      sourceId: params.source_id,
      sourceGroup: params.source_group,
      sourceKind: params.source_kind,
      dateFrom: params.date_from,
      dateTo: params.date_to,
      // Semantic search defaults to spanning everything, including
      // excluded-tier items, because intent often conflicts with curator
      // heuristics (an excluded interview can be exactly what an agent needs).
      includeExcluded: params.tier === "all",
    });

    return {
      mode: "semantic",
      q: params.q,
      items: result.items,
      total: result.total,
      limit: params.limit,
      offset: 0,
      embeddingDims: result.embeddingDims,
      latencyMs: Date.now() - started,
    };
  }

  const feedQuery = searchFeedQueryFromParams(params);
  const [items, total] = await Promise.all([
    getFeaturedStories(feedQuery),
    countFeaturedStories(feedQuery),
  ]);

  return {
    mode: "lexical",
    q: params.q,
    items,
    total,
    limit: params.limit,
    offset: params.offset,
  };
}
