/**
 * W9c-3 — the legacy per-source RSS route (/api/rss/[slug]) is force-dynamic (it
 * runs a per-request rate-limiter), so it can't use route-level revalidate like the
 * main/newsletter RSS. renderLegacyRssFeedCached wraps the render at the data layer
 * in unstable_cache (10-min TTL, own 'legacy-rss' tag), keyed by slug, so a poller
 * hitting one lane costs ~1 DB execution per TTL. The curated lane is the motivating
 * cost: with a single curated source, its post-JOIN filter can walk the full items
 * index (~21.6k rows) to fill LIMIT 50 — same unbounded-scan class as the pre-floor
 * main RSS. Non-breaking (RSS is recent-by-nature; 10-min staleness matches the
 * main/newsletter revalidate=600).
 *
 * The next/cache stub is a REAL memoizer (reproduces unstable_cache's args key), so
 * the tests exercise per-slug dedup + no-collision, not just config. Bun mock hygiene
 * (mock.module is PROCESS-GLOBAL): the next/cache stub is shape-complete
 * (unstable_cache + revalidateTag) and @/lib/rss/legacy-feeds is SPREAD-mocked,
 * overriding ONLY renderLegacyRssFeed — deliberately NOT @/db/client, whose shared
 * db() would poison every real-DB test in the process. The adapter lives in its own
 * module precisely so this stub sits one level below the SUT. Since the override has
 * no reliable per-file restore, any FUTURE test importing renderLegacyRssFeed from
 * @/lib/rss/legacy-feeds must register its own mock rather than rely on this one.
 */
import { beforeEach, describe, expect, it, mock } from "bun:test";
import * as actualLegacy from "@/lib/rss/legacy-feeds";
import type { LegacyRssSlug } from "@/lib/rss/legacy-feed-meta";

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
      // dropping cb.toString() is fine — keyParts ("legacy-rss:v1") is the single
      // cb in this suite, so keyParts+args (the slug) disambiguate.
      const k = JSON.stringify([keys, args]);
      if (!store.has(k)) store.set(k, await fn(...args));
      return store.get(k);
    };
  },
  revalidateTag: () => {},
}));

// Stub the render (one level below the cache adapter); count calls to prove
// dedup / no-collision. Echo the slug so distinct lanes yield distinct output.
let renderCalls: LegacyRssSlug[] = [];
mock.module("@/lib/rss/legacy-feeds", () => ({
  ...actualLegacy,
  renderLegacyRssFeed: async (slug: LegacyRssSlug) => {
    renderCalls.push(slug);
    return `<rss><item>${slug}</item></rss>`;
  },
}));

const { renderLegacyRssFeedCached, LEGACY_RSS_CACHE_TAG } = await import(
  "@/lib/rss/legacy-feeds-cache"
);

beforeEach(() => {
  store.clear();
  renderCalls = [];
});

describe("renderLegacyRssFeedCached read-budget cache (W9c-3)", () => {
  it("wraps the render in unstable_cache with its own tag + 10-min TTL", async () => {
    // Wrapper is built per call (call-time construction), so trigger one.
    await renderLegacyRssFeedCached("today");
    const c = ucCalls.find((x) => x.tags?.includes("legacy-rss"));
    expect(LEGACY_RSS_CACHE_TAG).toBe("legacy-rss");
    expect(c).toBeDefined();
    expect(c?.tags).toEqual(["legacy-rss"]);
    expect(c?.revalidate).toBe(600);
  });

  it("delegates to renderLegacyRssFeed and returns its output", async () => {
    const xml = await renderLegacyRssFeedCached("today");
    expect(renderCalls).toEqual(["today"]);
    expect(xml).toBe("<rss><item>today</item></rss>");
  });

  it("dedupes a hot lane to ONE render", async () => {
    const a = await renderLegacyRssFeedCached("curated");
    const b = await renderLegacyRssFeedCached("curated");
    expect(renderCalls).toEqual(["curated"]); // second served from cache
    expect(b).toBe(a);
  });

  it("does NOT collide distinct lanes (each slug keys separately)", async () => {
    // Include `daily` — the structurally-distinct lane (newsletter columns, not
    // items) — to prove the slug-agnostic adapter keys all three separately.
    const c = await renderLegacyRssFeedCached("curated");
    const t = await renderLegacyRssFeedCached("today");
    const d = await renderLegacyRssFeedCached("daily");
    expect(renderCalls).toEqual(["curated", "today", "daily"]); // all keyed apart
    expect(new Set([c, t, d]).size).toBe(3);
  });
});
