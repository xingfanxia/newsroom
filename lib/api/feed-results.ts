import {
  countFeaturedStories,
  getFeaturedStories,
  type FeedQuery,
} from "@/lib/items/live";
import {
  toPublicApiItem,
  type PublicApiItem,
} from "@/lib/api/public-items";
import { toAgentApiItem, type AgentApiItem } from "@/lib/api/v1-items";
import type { AppLocale, FeedView, Story } from "@/lib/types";

export type FeedExecutionResult = {
  items: Story[];
  total: number;
  limit: number;
  offset: number;
  view: FeedView;
};

export type PublicFeedPayload = {
  items: PublicApiItem[];
  total: number;
  limit: number;
  offset: number;
  view: FeedView;
};

export type AgentFeedPayload = {
  items: AgentApiItem[];
  total: number;
  limit: number;
  offset: number;
  view: FeedView;
};

/**
 * Shared feed execution for REST feed routes and MCP ax_radar_feed.
 * Surface adapters own auth/rate-limit/cache/envelopes; this module owns the
 * paired item + total query and payload mapping so pagination and exposure
 * semantics cannot drift.
 */
export async function runFeedQuery(
  feedQuery: FeedQuery,
): Promise<FeedExecutionResult> {
  const [items, total] = await Promise.all([
    getFeaturedStories(feedQuery),
    countFeaturedStories(feedQuery),
  ]);

  return {
    items,
    total,
    limit: feedQuery.limit ?? 40,
    offset: feedQuery.offset ?? 0,
    view: feedQuery.view ?? "archive",
  };
}

export function toPublicFeedPayload(
  result: FeedExecutionResult,
  locale: AppLocale,
): PublicFeedPayload {
  return {
    items: result.items.map((story) => toPublicApiItem(story, locale)),
    total: result.total,
    limit: result.limit,
    offset: result.offset,
    view: result.view,
  };
}

export function toAgentFeedPayload(
  result: FeedExecutionResult,
  locale: AppLocale,
): AgentFeedPayload {
  return {
    items: result.items.map((story) => toAgentApiItem(story, locale)),
    total: result.total,
    limit: result.limit,
    offset: result.offset,
    view: result.view,
  };
}
