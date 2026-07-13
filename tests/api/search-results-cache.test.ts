/**
 * W9c-2 — the search surfaces (/api/public/search, /api/v1/search, MCP
 * ax_radar_search) funnel through runSearchQuery, which dedupes identical
 * param-keyed executions behind unstable_cache (10-min TTL, own 'search-api'
 * tag). Non-breaking: no floor, totals/pagination unchanged. The semantic
 * branch's latencyMs is stamped OUTSIDE the cache, so a hit reports its true
 * (fast) response time rather than the frozen miss-time latency.
 *
 * The next/cache stub is a REAL memoizer (not a passthrough) reproducing
 * unstable_cache's key = keyParts + JSON.stringify(args), so the tests exercise
 * the two behaviors this PR adds and NOTHING a passthrough would let slip:
 *   - dedupe / no-collision across param sets (lexical),
 *   - the semantic offset-canonicalization (runSearchQuery's cacheArg), and
 *   - the latency override — asserted so it FAILS if the override is deleted
 *     (a delayed miss stamps latencyMs > 0; the frozen placeholder is 0).
 *
 * Bun mock hygiene (mock.module is PROCESS-GLOBAL): the next/cache stub is
 * shape-complete, and the @/lib/items/live + @/lib/items/semantic-search stubs
 * SPREAD the real modules and override only the queried fns, so sibling suites'
 * imports of the other exports survive.
 */
import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import * as actualLive from "@/lib/items/live";
import * as actualSemantic from "@/lib/items/semantic-search";
import type { FeedQuery } from "@/lib/items/live";
import type { Story } from "@/lib/types";
import type { SearchExecutionParams } from "@/lib/api/search-results";

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
      // we intentionally drop cb.toString() — keyParts ("search-api:v1") already
      // disambiguates within this single-cb suite, so args+keyParts suffice.
      const k = JSON.stringify([keys, args]);
      if (!store.has(k)) store.set(k, await fn(...args));
      return store.get(k);
    };
  },
  revalidateTag: () => {},
}));

const story: Story = {
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

let lexicalCalls = 0;
mock.module("@/lib/items/live", () => ({
  ...actualLive,
  getFeaturedStories: async () => {
    lexicalCalls += 1;
    return [story];
  },
  // Echo offset into the total so distinct param sets yield distinct results.
  countFeaturedStories: async (q: FeedQuery = {}) => (q.offset ?? 0) + 1,
}));

let semanticCalls = 0;
mock.module("@/lib/items/semantic-search", () => ({
  ...actualSemantic,
  semanticSearch: async () => {
    semanticCalls += 1;
    return {
      items: [{ ...story, distance: 0.12 }],
      total: 1,
      embeddingDims: 256,
    };
  },
}));

const { runSearchQuery, SEARCH_API_CACHE_TAG } = await import(
  "@/lib/api/search-results"
);

const base = {
  tier: "all",
  locale: "en",
  limit: 20,
  offset: 0,
} as const;

beforeEach(() => {
  store.clear();
  lexicalCalls = 0;
  semanticCalls = 0;
});

describe("runSearchQuery read-budget cache (W9c-2)", () => {
  it("wraps search execution in unstable_cache with its own tag + 10-min TTL", async () => {
    expect(SEARCH_API_CACHE_TAG).toBe("search-api");
    // The wrapper is built per call (call-time construction), so trigger one.
    await runSearchQuery({ ...base, q: "x", mode: "lexical" } as SearchExecutionParams);
    const c = ucCalls.find((x) => x.tags?.includes("search-api"));
    expect(c).toBeDefined();
    expect(c?.tags).toEqual(["search-api"]);
    expect(c?.revalidate).toBe(600);
  });

  it("lexical: delegates to the paired item + count query, contract unchanged", async () => {
    const params = { ...base, q: "gpt", mode: "lexical" } as SearchExecutionParams;
    const result = await runSearchQuery(params);

    expect(lexicalCalls).toBe(1);
    expect(result).toMatchObject({
      mode: "lexical",
      q: "gpt",
      items: [story],
      total: 1, // offset 0 → 1
      limit: 20,
      offset: 0,
    });
  });

  it("lexical: dedupes identical params, does NOT collide distinct params", async () => {
    const q = { ...base, q: "gpt", mode: "lexical" } as SearchExecutionParams;
    const a = await runSearchQuery(q);
    const b = await runSearchQuery(q);
    expect(lexicalCalls).toBe(1); // second served from cache
    expect(b).toEqual(a);

    const c = await runSearchQuery({ ...q, offset: 40 } as SearchExecutionParams);
    expect(lexicalCalls).toBe(2); // distinct key → executed
    expect(c.total).toBe(41); // offset 40 → 41, no collision with a.total (1)
  });

  it("semantic: delegates, stamps a REAL latency (override observable)", async () => {
    // Mock Date.now to ALWAYS advance so the elapsed stamp is deterministic (no
    // wall-clock dependency): runSearchQuery captures started = Date.now() then
    // Date.now() - started, so an advancing clock guarantees latencyMs > 0.
    let clock = 1000;
    const nowSpy = spyOn(Date, "now").mockImplementation(() => (clock += 5));
    try {
      const params = {
        ...base,
        q: "agents",
        mode: "semantic",
      } as SearchExecutionParams;
      const result = await runSearchQuery(params);

      expect(semanticCalls).toBe(1);
      expect(result.mode).toBe("semantic");
      if (result.mode === "semantic") {
        expect(result.embeddingDims).toBe(256);
        expect(result.items[0]).toMatchObject({ distance: 0.12 });
        // The outside-the-cache stamp reflects the advancing clock. The frozen
        // placeholder (0) would fail this — kills the deleted-override mutant, and
        // the mocked clock makes it deterministic, not timing-flaky.
        expect(result.latencyMs).toBeGreaterThan(0);
      }
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("semantic: canonicalizes offset out of the cache key (paging dedupes)", async () => {
    const p0 = {
      ...base,
      q: "agents",
      mode: "semantic",
      offset: 0,
    } as SearchExecutionParams;
    const p40 = { ...p0, offset: 40 } as SearchExecutionParams;

    await runSearchQuery(p0);
    await runSearchQuery(p40);
    // Semantic always returns offset 0 and pages via dates, so offset is dropped
    // from the key — the second call hits the same entry, no re-embed.
    expect(semanticCalls).toBe(1);
  });
});
