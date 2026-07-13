import { revalidateTag, unstable_cache } from "next/cache";
import {
  getDayCounts,
  getPulseData,
  getRadarStats,
  getTopTopics,
  type DayBucket,
} from "@/lib/shell/dashboard-stats";
import { getRecentTickerItems } from "@/lib/shell/ticker";
import type { RadarStats } from "@/lib/shell/radar-stats";
import type { PulsePoint } from "@/components/shell/pulse-box";
import type { TopicEntry } from "@/components/feed/right-rail";
import type { TickerItem } from "@/components/feed/ticker";
import type { AppLocale } from "@/lib/types";

/**
 * W8b — the cache adapter in front of the feed-derived aggregates + calendar
 * counts. Every public-feed render recomputes these: the pages read
 * `searchParams`, which voids `export const revalidate`, so each request
 * re-renders dynamically. `getDayCounts` alone rescans the 60-day window (the
 * dominant per-render cost left after W8a's recency floor, which can't reduce a
 * calendar scan). `unstable_cache` dedupes them across renders; content-mutating
 * crons call `revalidateFeedCache()` so a new/enriched/clustered/scored item
 * surfaces on the next regenerated render rather than waiting out the TTL (see
 * revalidateFeedCache for the stale-while-revalidate caveat).
 *
 * Kept separate from dashboard-stats.ts / ticker.ts so those stay pure query
 * functions (unit-testable, no `next/cache` coupling) — this is the adapter.
 *
 * Two construction styles, both correct — DON'T unify them: a param-free reader
 * (radar/pulse) is memoised ONCE at module load as `unstable_cache(fn, key)`;
 * an arg-taking reader (day-counts/top-topics/ticker) must fold its runtime args
 * into `keyParts` per call, so it builds the cache inside the wrapper and invokes
 * it. Rewriting the arg-taking ones module-level would drop the args from the key
 * and collapse distinct calls onto one poisoned entry.
 */

/** Shared invalidation tag for every feed-derived cache entry. */
export const FEED_CACHE_TAG = "feed";

/**
 * TTL backstop (seconds). Normal freshness is content-driven: the enrich cron
 * (every 15 min — the tightest content heartbeat) calls revalidateFeedCache
 * after flipping enriched_at/importance/tags. This ceiling only bounds staleness
 * if an invalidation is ever missed; 30 min is well inside news-radar tolerance.
 */
const FEED_CACHE_TTL = 1800;

const cacheOpts = { revalidate: FEED_CACHE_TTL, tags: [FEED_CACHE_TAG] };

/**
 * Calendar-grid day counts — the 60-day scan the recency floor can't bound, so
 * the biggest post-W8a per-render cost. Keyed on days + opts (home passes
 * {tier:'featured'}, /all passes none, /curated passes {curatedOnly:true} → a
 * handful of stable keys, high hit rate).
 */
export function getDayCountsCached(
  days = 30,
  opts?: Parameters<typeof getDayCounts>[1],
): Promise<DayBucket[]> {
  return unstable_cache(
    () => getDayCounts(days, opts),
    ["feed:day-counts", String(days), JSON.stringify(opts ?? {})],
    cacheOpts,
  )();
}

/** Radar-widget 24h counts (param-free → one cache entry). */
export const getRadarStatsCached: () => Promise<RadarStats> = unstable_cache(
  getRadarStats,
  ["feed:radar-stats"],
  cacheOpts,
);

/** 24 hourly pulse buckets (param-free → one cache entry). */
export const getPulseDataCached: () => Promise<PulsePoint[]> = unstable_cache(
  getPulseData,
  ["feed:pulse"],
  cacheOpts,
);

/** Top tags over the last 7 days. */
export function getTopTopicsCached(limit = 16): Promise<TopicEntry[]> {
  return unstable_cache(
    () => getTopTopics(limit),
    ["feed:top-topics", String(limit)],
    cacheOpts,
  )();
}

/** Locale-specific ticker items (top 24h stories). */
export function getRecentTickerItemsCached(
  locale: AppLocale,
  limit = 12,
): Promise<TickerItem[]> {
  return unstable_cache(
    () => getRecentTickerItems(locale, limit),
    ["feed:ticker", locale, String(limit)],
    cacheOpts,
  )();
}

/**
 * Purge every feed-derived cache entry. Called from content-mutating cron route
 * handlers (enrich / cluster / score-backfill / normalize) after they change
 * items/clusters/importance/tags, so the next render recomputes fresh instead of
 * waiting out FEED_CACHE_TTL.
 *
 * `'max'` is stale-while-revalidate: the purge is immediate, but the FIRST render
 * after it may still serve the prior value once while the fresh value regenerates
 * in the background — so "next render" is a floor, not a guarantee of same-render
 * freshness. Single-arg revalidateTag is deprecated in Next 16; route-handler /
 * server-action context only.
 *
 * NOT wired to manual `scripts/ops/*` (seed-sources, reset-*, cleanup-*) that
 * mutate sources/items/clusters out-of-band — those rely on the FEED_CACHE_TTL
 * backstop (≤30 min) or an admin cache purge if immediacy matters.
 */
export function revalidateFeedCache(): void {
  revalidateTag(FEED_CACHE_TAG, "max");
}
