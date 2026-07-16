/**
 * W8b — the feed-cache adapter dedupes the aggregates + calendar counts across
 * uncached feed renders, and the content-mutating crons purge them via one
 * shared tag. Two levels:
 *   1. BEHAVIORAL (next/cache + the raw stat modules mocked, so no DB / Next
 *      runtime): every cached wrapper routes through unstable_cache with the
 *      shared 'feed' tag + TTL and a DISTINCT key prefix (no cross-function
 *      collision), delegates to its raw function, and revalidateFeedCache()
 *      purges the 'feed' tag with a valid profile.
 *   2. Wiring tripwires: the 4 content crons opt into revalidateFeed, the fetch
 *      buckets deliberately do NOT, _route.ts honors the opt, and the page /
 *      chrome call sites use the Cached variants.
 *
 * OUT OF SCOPE (inherent to unit-testing a cache adapter): that revalidateTag
 * actually evicts live unstable_cache entries is a Next runtime behavior we mock
 * away here — it's covered by the Next 16.2.4 source read in the W8b review, not
 * by CI. These tests guard the wiring around that seam, not the seam itself.
 */
import { describe, expect, it, mock } from "bun:test";
import { readSource } from "@/tests/helpers/source";

// --- Level 1: behavioral. Mock BEFORE importing the module under test. ---
//
// Bun mock hygiene: mock.module is PROCESS-GLOBAL with no reliable per-file
// restore, so any test importing @/lib/shell/feed-cache (or @/app/api/cron/_route)
// MUST register its own next/cache mock rather than rely on this one leaking in —
// otherwise its assertions depend on file load order. See tests/cron/route-purge.

const revalidateTagCalls: Array<[string, unknown]> = [];
const ucCalls: Array<{ keys: unknown[]; tags?: string[]; revalidate?: number }> = [];

mock.module("next/cache", () => ({
  unstable_cache: (
    fn: (...a: unknown[]) => unknown,
    keys: unknown[],
    opts: { tags?: string[]; revalidate?: number },
  ) => {
    ucCalls.push({ keys, tags: opts?.tags, revalidate: opts?.revalidate });
    return fn; // passthrough — invoking the wrapper just calls the raw fn
  },
  revalidateTag: (tag: string, profile: unknown) => {
    revalidateTagCalls.push([tag, profile]);
  },
}));

mock.module("@/lib/shell/dashboard-stats", () => ({
  getDayCounts: async () => [{ date: "2026-07-13", count: 3 }],
  getRadarStats: async () => ({
    items_today: 5,
    items_p1: 1,
    items_featured: 2,
    tracked_sources: 9,
  }),
  getPulseData: async () => [{ h: 0, c: 4 }],
  getTopTopics: async () => [{ tag: "gpt", count: 7, hot: true }],
}));
mock.module("@/lib/shell/ticker", () => ({
  getRecentTickerItems: async () => [{ lab: "OPENAI", val: "ships" }],
}));

const {
  FEED_CACHE_TAG,
  FEED_CALENDAR_TAG,
  revalidateFeedCache,
  getDayCountsCached,
  getRadarStatsCached,
  getPulseDataCached,
  getTopTopicsCached,
  getRecentTickerItemsCached,
} = await import("@/lib/shell/feed-cache");

/** The unstable_cache call recorded for a given key prefix (last one wins). */
const ucFor = (prefix: string) =>
  [...ucCalls].reverse().find((c) => String(c.keys[0]) === prefix);

describe("feed-cache — two cache tiers (aggregates vs calendar) + distinct keys", () => {
  it("exposes both invalidation tags", () => {
    expect(FEED_CACHE_TAG).toBe("feed");
    expect(FEED_CALENDAR_TAG).toBe("feed-calendar");
  });

  it("each wrapper delegates to its raw function", async () => {
    expect(await getRadarStatsCached()).toMatchObject({ items_today: 5 });
    expect(await getPulseDataCached()).toEqual([{ h: 0, c: 4 }]);
    expect(await getDayCountsCached(60, { tier: "featured" })).toEqual([
      { date: "2026-07-13", count: 3 },
    ]);
    expect(await getTopTopicsCached()).toEqual([
      { tag: "gpt", count: 7, hot: true },
    ]);
    expect(await getRecentTickerItemsCached("en")).toEqual([
      { lab: "OPENAI", val: "ships" },
    ]);
  });

  it("cheap aggregates carry tags:['feed'] + the 30-min TTL", () => {
    for (const prefix of [
      "feed:radar-stats",
      "feed:pulse",
      "feed:top-topics",
      "feed:ticker",
    ]) {
      const c = ucFor(prefix);
      expect(c?.tags).toEqual(["feed"]);
      expect(c?.revalidate).toBe(1800);
    }
  });

  it("W9b: day-counts is decoupled to tags:['feed-calendar'] + a 6h TTL", () => {
    // Its own tag so the content crons' feed purge doesn't reprime the 60-day
    // scan; 6h TTL is its only freshness mechanism (read-budget lever).
    const c = ucFor("feed:day-counts");
    expect(c?.tags).toEqual(["feed-calendar"]);
    expect(c?.revalidate).toBe(21_600);
  });

  it("key prefixes are distinct per function (no cross-function collision)", () => {
    const prefixes = new Set(ucCalls.map((c) => String(c.keys[0])));
    expect(prefixes).toEqual(
      new Set([
        "feed:day-counts",
        "feed:radar-stats",
        "feed:pulse",
        "feed:top-topics",
        "feed:ticker",
      ]),
    );
  });

  it("getDayCountsCached keys distinctly per opts (home vs curated don't share an entry)", async () => {
    const before = ucCalls.length;
    await getDayCountsCached(60, { tier: "featured" });
    await getDayCountsCached(60, { curatedOnly: true });
    const added = ucCalls.slice(before).map((c) => JSON.stringify(c.keys));
    expect(new Set(added).size).toBe(2);
  });

  it("ticker keys include the locale (zh and en are separate entries)", async () => {
    const before = ucCalls.length;
    await getRecentTickerItemsCached("en");
    await getRecentTickerItemsCached("zh");
    const added = ucCalls.slice(before).map((c) => JSON.stringify(c.keys));
    expect(new Set(added).size).toBe(2);
  });

  it("revalidateFeedCache purges ONLY the 'feed' tag (never 'feed-calendar') with the 'max' profile", () => {
    revalidateTagCalls.length = 0;
    revalidateFeedCache();
    expect(revalidateTagCalls).toEqual([["feed", "max"]]);
  });
});

// --- Level 2: wiring tripwires (source checks — crons/routes aren't unit-run here). ---

describe("content-mutating crons opt into feed-cache invalidation (W9b: conditionally)", () => {
  it("cluster purges unconditionally (7-stage pipeline, ~always mutates)", () => {
    expect(readSource("app/api/cron/cluster/route.ts")).toContain(
      "revalidateFeed: true",
    );
  });

  it("enrich / score-backfill / normalize purge only when the run changed content", () => {
    // A predicate `(b) => …count > 0` — an idle tick must NOT evict the cache.
    const conditional: Record<string, RegExp> = {
      enrich: /revalidateFeed:\s*\(b\)\s*=>\s*b\.enrich\.enriched\s*>\s*0/,
      "score-backfill": /revalidateFeed:\s*\(b\)\s*=>\s*b\.score\.rescored\s*>\s*0/,
      normalize: /revalidateFeed:\s*\(b\)\s*=>\s*b\.normalize\.created\s*>\s*0/,
    };
    for (const [cron, re] of Object.entries(conditional)) {
      const src = readSource(`app/api/cron/${cron}/route.ts`);
      expect(src).toMatch(re);
      expect(src).not.toContain("revalidateFeed: true");
    }
  });

  it("fetch buckets deliberately do NOT invalidate (raw items surface via enrich)", () => {
    expect(readSource("app/api/cron/_fetch-bucket-route.ts")).not.toContain(
      "revalidateFeed",
    );
  });

  it("_route.ts resolves boolean|predicate opts into a single shouldPurge gate", () => {
    const src = readSource("app/api/cron/_route.ts");
    expect(src).toContain("revalidateFeedCache");
    // Predicate form is invoked with the built body; boolean form compares ===true.
    expect(src).toMatch(/opts\.revalidateFeed\(body\)/);
    expect(src).toMatch(/if\s*\(shouldPurge\)\s*revalidateFeedCache\(\)/);
  });
});

describe("public page call sites derive from snapshots", () => {
  it("chrome shell derives radar + pulse from the snapshot reader", () => {
    const src = readSource("lib/shell/chrome-data.ts");
    expect(src).toContain("publicSnapshotReader");
    expect(src).toContain("deriveRadarStats");
    expect(src).toContain("derivePulseData");
    expect(src).not.toContain("@/lib/shell/feed-cache");
  });

  it("home derives day counts + topics + ticker from one snapshot", () => {
    // R2 materialized-page cutover: the page delegates to
    // readCachedPublicHomePageModel; the single-snapshot derivation
    // lives in home-page-model.ts + the home builder.
    const pageSrc = readSource("app/[locale]/page.tsx");
    expect(pageSrc).toContain("readCachedPublicHomePageModel");
    expect(pageSrc).not.toContain("@/lib/shell/feed-cache");
    const modelSrc = readSource("lib/public-content/home-page-model.ts");
    expect(modelSrc).toContain("readPublicPageSnapshot");
    const builderSrc = readSource("lib/public-content/page-model-builders.ts");
    expect(builderSrc).toContain("deriveDayCounts");
    expect(builderSrc).toContain("deriveTopTopics");
    expect(builderSrc).toContain("deriveRecentTickerItems");
    expect(builderSrc).not.toContain("@/lib/shell/feed-cache");
  });

  it("/all + /curated derive their day counts from snapshots", () => {
    // Same cutover: pages call read*PageModel; deriveDayCounts lives in
    // the all/curated builders (asserted per-builder in
    // tests/shell/calendar-counts.test.ts).
    expect(readSource("app/[locale]/all/page.tsx")).toContain(
      "readAllPageModel",
    );
    expect(readSource("app/[locale]/curated/page.tsx")).toContain(
      "readCuratedPageModel",
    );
    const builderSrc = readSource("lib/public-content/page-model-builders.ts");
    expect(builderSrc).toContain("deriveDayCounts(state, 60, {}, nowMs)");
    expect(builderSrc).toContain(
      "deriveDayCounts(state, 60, { curatedOnly: true }, nowMs)",
    );
  });
});
