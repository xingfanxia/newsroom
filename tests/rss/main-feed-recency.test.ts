/**
 * W9c — the main RSS render must carry the recency floor on its PRIMARY featured
 * query so it SEEKs items_feed_recent_idx instead of scanning the whole enriched
 * corpus (~21.7K rows) on every 10-min revalidation — while the slow-day
 * fallback stays UNFLOORED (safety net for a content drought). Behavioral: stub
 * getFeaturedStories so no DB is touched, capture every call, render the feed,
 * and assert the floor is present on featured and ABSENT on the fallback.
 *
 * Bun mock hygiene: mock.module is PROCESS-GLOBAL. Returning a bare
 * `{ getFeaturedStories }` would DROP every other export of @/lib/items/live
 * (countFeaturedStories, buildFeedWhere, getEventMembers, …) for ALL suites in
 * the run — a partial mock leaks OUT and breaks unrelated files at import time.
 * So we spread the real module and override only the one function.
 */
import { describe, expect, it, mock } from "bun:test";
import * as actualLive from "@/lib/items/live";
import type { FeedQuery } from "@/lib/items/live";
import type { Story } from "@/lib/types";

const calls: FeedQuery[] = [];
let nextResult: Story[] = [];

mock.module("@/lib/items/live", () => ({
  ...actualLive,
  getFeaturedStories: async (q: FeedQuery = {}) => {
    calls.push(q);
    return nextResult;
  },
}));

const { renderMainRssFeed, MAIN_RSS_RECENCY_FLOOR_DAYS } = await import(
  "@/lib/rss/main-feed"
);

const story: Story = {
  id: "1",
  sourceId: "openai-blog",
  source: { publisher: "OpenAI", kindCode: "rss", localeCode: "en" },
  featured: true,
  title: "Model update",
  summary: "s",
  tags: [],
  importance: 88,
  tier: "featured",
  publishedAt: "2026-07-10T10:00:00.000Z",
  url: "https://example.com/a",
  locale: "en",
  hkr: { h: true, k: false, r: true },
};

describe("main RSS feed recency floor (W9c)", () => {
  it("floor is tight enough to seek yet ample for the 50-item limit", () => {
    // The read-budget intent: small enough that the recent-window seek is a big
    // cut vs the full corpus scan, large enough to always hold ≥50 leads.
    expect(MAIN_RSS_RECENCY_FLOOR_DAYS).toBeGreaterThanOrEqual(7);
    expect(MAIN_RSS_RECENCY_FLOOR_DAYS).toBeLessThanOrEqual(30);
  });

  it("passes the floor on the primary featured query", async () => {
    calls.length = 0;
    nextResult = [story];
    await renderMainRssFeed("en");

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      tier: "featured",
      limit: 50,
      recencyFloorDays: MAIN_RSS_RECENCY_FLOOR_DAYS,
    });
  });

  it("leaves the slow-day fallback UNFLOORED (drought safety net)", async () => {
    calls.length = 0;
    nextResult = []; // featured empty → fall back to tier:'all'
    await renderMainRssFeed("en");

    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ tier: "all", limit: 50 });
    expect(calls[1]!.recencyFloorDays).toBeUndefined();
  });
});
