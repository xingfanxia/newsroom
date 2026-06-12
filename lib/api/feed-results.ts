import {
  countFeaturedStories,
  getFeaturedStories,
  type FeedQuery,
} from "@/lib/items/live";
import type { Story } from "@/lib/types";

export type FeedExecutionResult = {
  items: Story[];
  total: number;
  limit: number;
  offset: number;
  view: FeedQuery["view"];
};

/**
 * Shared feed execution for /api/v1/feed and /api/public/feed.
 * Route handlers own auth/rate-limit/ETag/serialization; this module owns the
 * paired item + total query so pagination semantics cannot drift by surface.
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
