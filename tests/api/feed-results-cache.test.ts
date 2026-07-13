/**
 * W9c-2 — the JSON feed surfaces (/api/public/feed, /api/v1/feed, MCP
 * ax_radar_feed) all funnel through runFeedQuery, which must dedupe identical
 * param-keyed executions behind unstable_cache with a ~10-min TTL and its OWN
 * 'feed-api' tag (pure TTL, not cron-purged) — bounding db load without any
 * API-contract change (no floor: total stays all-time, pagination unbounded).
 *
 * The next/cache stub is a REAL memoizer (not a passthrough) that reproduces
 * unstable_cache's key = keyParts + JSON.stringify(args), so the tests actually
 * exercise (a) dedupe of identical calls and (b) NO collision across distinct
 * param sets — the correctness the PR rests on.
 *
 * Bun mock hygiene (mock.module is PROCESS-GLOBAL, no reliable restore): the
 * next/cache stub is shape-complete (unstable_cache + revalidateTag) so it can't
 * drop an export another suite imports; the @/lib/items/live stub SPREADS the real
 * module and overrides only the two query fns, so buildFeedWhere / feedIndexFor /
 * getEventMembers etc. survive for sibling suites.
 */
import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { FeedQuery } from "@/lib/items/live";
import * as actualLive from "@/lib/items/live";
import type { Story } from "@/lib/types";

const ucCalls: Array<{
  keys: unknown[];
  tags?: string[];
  revalidate?: number;
}> = [];
const store = new Map<string, unknown>();

mock.module("next/cache", () => ({
  unstable_cache: (
    fn: (...a: unknown[]) => Promise<unknown>,
    keys: unknown[],
    opts: { tags?: string[]; revalidate?: number },
  ) => {
    ucCalls.push({ keys, tags: opts?.tags, revalidate: opts?.revalidate });
    return async (...args: unknown[]) => {
      // Real unstable_cache keys on cb.toString()+keyParts+JSON.stringify(args);
      // we intentionally drop cb.toString() — keyParts ("feed-api:v1") already
      // disambiguates within this single-cb suite, so args+keyParts suffice.
      const k = JSON.stringify([keys, args]);
      if (!store.has(k)) store.set(k, await fn(...args));
      return store.get(k);
    };
  },
  revalidateTag: () => {},
}));

const baseStory: Story = {
  id: "1",
  sourceId: "openai-blog",
  source: { publisher: "OpenAI", kindCode: "rss", localeCode: "en" },
  featured: true,
  title: "t",
  summary: "s",
  tags: [],
  importance: 88,
  tier: "featured",
  publishedAt: "2026-07-10T10:00:00.000Z",
  url: "https://example.com/a",
  locale: "en",
  hkr: { h: true, k: false, r: true },
};

const featuredCalls: FeedQuery[] = [];
const countCalls: FeedQuery[] = [];

mock.module("@/lib/items/live", () => ({
  ...actualLive,
  // Echo the query into the result so distinct params yield distinct output.
  getFeaturedStories: async (q: FeedQuery = {}) => {
    featuredCalls.push(q);
    return [{ ...baseStory, id: String(q.tier ?? "?") }];
  },
  countFeaturedStories: async (q: FeedQuery = {}) => {
    countCalls.push(q);
    return (q.offset ?? 0) + 1;
  },
}));

const { runFeedQuery, FEED_API_CACHE_TAG } = await import(
  "@/lib/api/feed-results"
);

beforeEach(() => {
  store.clear();
  featuredCalls.length = 0;
  countCalls.length = 0;
});

describe("runFeedQuery read-budget cache (W9c-2)", () => {
  it("wraps the feed execution in unstable_cache with its own tag + 10-min TTL", async () => {
    expect(FEED_API_CACHE_TAG).toBe("feed-api");
    // The wrapper is built per call (call-time construction), so trigger one.
    await runFeedQuery({ tier: "featured", locale: "en" });
    const c = ucCalls.find((x) => x.tags?.includes("feed-api"));
    expect(c).toBeDefined();
    expect(c?.tags).toEqual(["feed-api"]);
    expect(c?.revalidate).toBe(600);
  });

  it("delegates to the paired item + count query and returns their result", async () => {
    const q: FeedQuery = { tier: "featured", limit: 20, offset: 0, locale: "en" };
    const result = await runFeedQuery(q);

    expect(featuredCalls).toEqual([q]);
    expect(countCalls).toEqual([q]);
    expect(result).toMatchObject({
      items: [{ id: "featured" }],
      total: 1,
      limit: 20,
      offset: 0,
    });
  });

  it("dedupes identical param sets to ONE DB execution", async () => {
    const q: FeedQuery = { tier: "featured", limit: 20, offset: 0, locale: "en" };
    const a = await runFeedQuery(q);
    const b = await runFeedQuery(q);

    expect(featuredCalls).toHaveLength(1); // second call served from cache
    expect(countCalls).toHaveLength(1);
    expect(b).toEqual(a);
  });

  it("does NOT collide distinct param sets (each keys separately)", async () => {
    const a = await runFeedQuery({ tier: "featured", offset: 0, locale: "en" });
    const b = await runFeedQuery({ tier: "all", offset: 40, locale: "en" });

    expect(featuredCalls).toHaveLength(2); // distinct keys → both executed
    expect(a.items[0]!.id).toBe("featured");
    expect(b.items[0]!.id).toBe("all");
    expect(a.total).not.toBe(b.total); // offset 0 → 1 vs offset 40 → 41
  });

  it("does NOT window the total (no recency floor — contract unchanged)", async () => {
    await runFeedQuery({ tier: "all", limit: 50, offset: 100, locale: "zh" });
    expect(countCalls[0]).not.toHaveProperty("recencyFloorDays");
  });
});
