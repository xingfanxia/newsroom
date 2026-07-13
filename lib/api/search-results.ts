import { unstable_cache } from "next/cache";
import {
  countFeaturedStories,
  getFeaturedStories,
} from "@/lib/items/live";
import { semanticSearch } from "@/lib/items/semantic-search";
import {
  searchFeedQueryFromParams,
  type SearchQueryParams,
} from "@/lib/api/feed-query-params";
import { DEFAULT_SEARCH_OFFSET } from "@/lib/search/query-defaults";
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
 * Read-budget cache (W9c-2) for the search surfaces — the heavy peer of the feed
 * cache. The lexical branch runs the same getFeaturedStories + countFeaturedStories
 * scan (~43K rows on prod); the semantic branch embeds `q` (an LLM call) then runs
 * a vector query. Both are force-dynamic + uncached, so a repeated identical query
 * re-pays the full cost. Dedupe behind a ~10-min TTL keyed by the search params —
 * non-breaking (no floor; totals + pagination unchanged), and it also spares the
 * repeated embedding call.
 *
 * Hit-rate caveat: unlike the feed (polled with identical default params), search
 * is free-text and high-cardinality, so the win concentrates on repeated/popular
 * queries + the v1/MCP paths a CDN can't cache — one-off queries just add a
 * short-lived entry. `unstable_cache` is stale-while-revalidate: past the TTL the
 * triggering request is served the stale value while a background revalidation
 * refreshes, which bounds a hot combo to ~1 DB execution per TTL (modulo a small
 * thundering-herd at the refresh boundary — see feed-results.ts). Own 'search-api'
 * tag, NOT cron-purged (pure TTL is the strongest db-load bound); exported for
 * manual/admin purge. Same request-scope coupling + freshness tradeoff as the feed
 * cache (see feed-results.ts module doc).
 */
export const SEARCH_API_CACHE_TAG = "search-api";
const SEARCH_API_CACHE_TTL = 600;

// SECURITY INVARIANT (see feed-results.ts executeFeedQuery): this cache entry is
// SHARED across public / v1 / MCP. Safe ONLY because visibility differences are
// key-included params or post-cache projection — executeSearchQuery takes no caller
// identity (semanticIncludeExcluded is a keyed param, so it participates in the
// key). Do NOT add caller-privilege-dependent row filtering here.
async function executeSearchQuery(
  params: SearchExecutionParams,
): Promise<SearchExecutionResult> {
  if (params.mode === "semantic") {
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
      offset: DEFAULT_SEARCH_OFFSET,
      embeddingDims: result.embeddingDims,
      // Placeholder — real end-to-end latency is stamped by runSearchQuery
      // OUTSIDE the cache, so a cache hit reports its true (fast) response time
      // instead of freezing the miss-time latency.
      latencyMs: 0,
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

/**
 * Shared execution for REST search routes and MCP ax_radar_search.
 * Surface adapters own auth/rate-limit/envelopes; this module owns the search
 * semantics, the read-budget cache, and payload mapping so lexical totals,
 * semantic filters, and metadata fields cannot drift.
 *
 * The `unstable_cache` wrapper is built PER CALL (see feed-results.ts's
 * runFeedQuery for why that's prod-identical to a module-scope singleton). Keyed
 * on keyParts + the JSON-serialized params, so each distinct query/filter set is
 * its own entry. Result is JSON-safe (Story dates are ISO strings; semantic items
 * add a numeric `distance`), so the round-trip preserves types.
 */
export async function runSearchQuery(
  params: SearchExecutionParams,
): Promise<SearchExecutionResult> {
  const started = Date.now();
  // Canonicalize the cache key for semantic mode: it always returns offset 0 and
  // pages via date_from/date_to, so `offset` and the single-day `date` don't affect
  // the result — dropping them from the key collapses ?offset=20 vs 40 (etc.) onto
  // one entry instead of storing identical results N times. Lexical uses both, so
  // it passes through untouched.
  const cacheArg: SearchExecutionParams =
    params.mode === "semantic"
      ? { ...params, offset: DEFAULT_SEARCH_OFFSET, date: undefined }
      : params;
  const result = await unstable_cache(executeSearchQuery, ["search-api:v1"], {
    revalidate: SEARCH_API_CACHE_TTL,
    tags: [SEARCH_API_CACHE_TAG],
  })(cacheArg);
  // Stamp real end-to-end latency OUTSIDE the cache so a hit reports its true
  // (fast) response time. NB: latencyMs now measures the whole cached call, not
  // just semanticSearch compute — for a miss they're ~equal.
  return result.mode === "semantic"
    ? { ...result, latencyMs: Date.now() - started }
    : result;
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
