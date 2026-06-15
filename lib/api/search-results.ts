import {
  countFeaturedStories,
  getFeaturedStories,
} from "@/lib/items/live";
import { semanticSearch } from "@/lib/items/semantic-search";
import {
  searchFeedQueryFromParams,
  type SearchQueryParams,
} from "@/lib/api/feed-query-params";
import {
  toPublicApiItem,
  type PublicApiItem,
} from "@/lib/api/public-items";
import { toAgentApiItem, type AgentApiItem } from "@/lib/api/v1-items";
import type { AppLocale, SearchMode, Story } from "@/lib/types";

type SemanticStory = Story & { distance: number };

export type SearchExecutionParams = SearchQueryParams & {
  mode: SearchMode;
  /**
   * Override semantic excluded-tier inclusion for surfaces whose tier contract
   * does not map 1:1 to REST query params. REST keeps the default tier-driven
   * behavior; MCP can preserve its historical non-excluded semantic scope while
   * still sharing the execution path.
   */
  semanticIncludeExcluded?: boolean;
};

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

type SemanticPayloadItem<Item> = Item & { distance: number };

export type PublicSearchPayload =
  | {
      mode: "lexical";
      q: string;
      items: PublicApiItem[];
      total: number;
      limit: number;
      offset: number;
    }
  | {
      mode: "semantic";
      q: string;
      items: Array<SemanticPayloadItem<PublicApiItem>>;
      total: number;
      limit: number;
      offset: 0;
      latency_ms: number;
    };

export type AgentSearchPayload =
  | {
      mode: "lexical";
      q: string;
      items: AgentApiItem[];
      total: number;
      limit: number;
      offset: number;
    }
  | {
      mode: "semantic";
      q: string;
      items: Array<SemanticPayloadItem<AgentApiItem>>;
      total: number;
      limit: number;
      offset: 0;
      embedding_dims: number;
      latency_ms: number;
    };

/**
 * Shared execution for REST search routes and MCP ax_radar_search.
 * Surface adapters own auth/rate-limit/cache/envelopes; this module owns the
 * search semantics and payload mapping so lexical totals, semantic filters,
 * and metadata fields cannot drift.
 */
export async function runSearchQuery(
  params: SearchExecutionParams,
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
      includeExcluded: params.semanticIncludeExcluded ?? params.tier === "all",
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

export function toPublicSearchPayload(
  result: SearchExecutionResult,
  locale: AppLocale,
): PublicSearchPayload {
  if (result.mode === "semantic") {
    return {
      mode: "semantic",
      q: result.q,
      items: result.items.map((story) => ({
        ...toPublicApiItem(story, locale),
        distance: story.distance,
      })),
      total: result.total,
      limit: result.limit,
      offset: result.offset,
      latency_ms: result.latencyMs,
    };
  }

  return {
    mode: "lexical",
    q: result.q,
    items: result.items.map((story) => toPublicApiItem(story, locale)),
    total: result.total,
    limit: result.limit,
    offset: result.offset,
  };
}

export function toAgentSearchPayload(
  result: SearchExecutionResult,
  locale: AppLocale,
): AgentSearchPayload {
  if (result.mode === "semantic") {
    return {
      mode: "semantic",
      q: result.q,
      items: result.items.map((story) => ({
        ...toAgentApiItem(story, locale),
        distance: story.distance,
      })),
      total: result.total,
      limit: result.limit,
      offset: result.offset,
      embedding_dims: result.embeddingDims,
      latency_ms: result.latencyMs,
    };
  }

  return {
    mode: "lexical",
    q: result.q,
    items: result.items.map((story) => toAgentApiItem(story, locale)),
    total: result.total,
    limit: result.limit,
    offset: result.offset,
  };
}
