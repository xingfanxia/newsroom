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
 * re-renders dynamically. `unstable_cache` dedupes them across renders.
 *
 * TWO CACHE TIERS, split in W9b because they have very different cost + freshness
 * profiles — DON'T merge them back:
 *   - FEED_CACHE_TAG ('feed') — the CHEAP bounded-window aggregates (radar/pulse
 *     = last 24h, top-topics = last 7d, ticker = top 24h). Content-mutating crons
 *     purge this tag (conditionally — only when a run actually changed content)
 *     so a freshly enriched item surfaces within one render. 30-min TTL backstop.
 *   - FEED_CALENDAR_TAG ('feed-calendar') — `getDayCounts`, the 60-day calendar
 *     scan the recency floor can't bound and the dominant per-render read cost.
 *     Deliberately NOT cron-purged: the calendar mini-map is a coarse navigation
 *     aid on a daily-update site, so a ≤6h staleness (today's cell counting
 *     44→45, or a brand-new day appearing a few hours late) is imperceptible —
 *     the feed itself is never calendar-gated, so new items still show instantly.
 *     Decoupling it drops its re-prime rate from the enrich heartbeat (~4×/h) to
 *     the 6h TTL (~4×/day), which is the W9b read-budget lever.
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

/** Invalidation tag for the cheap bounded-window aggregates (24h/7d). */
export const FEED_CACHE_TAG = "feed";

/**
 * Invalidation tag for the calendar day-counts only (60-day scan). Its own tag
 * so the content crons' feed purge does NOT reprime it — freshness comes from
 * FEED_CALENDAR_TTL instead (see the module doc for why ≤6h staleness is fine).
 */
export const FEED_CALENDAR_TAG = "feed-calendar";

/**
 * TTL backstop (seconds). Normal freshness is content-driven: the enrich cron
 * (every 15 min — the tightest content heartbeat) calls revalidateFeedCache
 * after flipping enriched_at/importance/tags. This ceiling only bounds staleness
 * if an invalidation is ever missed; 30 min is well inside news-radar tolerance.
 */
const FEED_CACHE_TTL = 1800;

/**
 * Calendar TTL (seconds) = 6h. This is the calendar's ONLY freshness mechanism
 * (no cron purge), and it doubles as the read-budget lever: the 60-day scan
 * reprimes at most 4×/day instead of riding the enrich heartbeat. 6h keeps the
 * day-count mini-map current enough for a daily-update site.
 */
const FEED_CALENDAR_TTL = 21_600;

const cacheOpts = { revalidate: FEED_CACHE_TTL, tags: [FEED_CACHE_TAG] };

const calendarCacheOpts = {
  revalidate: FEED_CALENDAR_TTL,
  tags: [FEED_CALENDAR_TAG],
};

/**
 * Calendar-grid day counts — the 60-day scan the recency floor can't bound, so
 * the biggest post-W8a per-render cost. Keyed on days + opts (home passes
 * {tier:'featured'}, /all passes none, /curated passes {curatedOnly:true} → a
 * handful of stable keys, high hit rate). Uses calendarCacheOpts (its own tag +
 * 6h TTL, NOT cron-purged) — see the module doc for why coarse staleness is fine.
 */
export function getDayCountsCached(
  days = 30,
  opts?: Parameters<typeof getDayCounts>[1],
): Promise<DayBucket[]> {
  return unstable_cache(
    () => getDayCounts(days, opts),
    ["feed:day-counts", String(days), JSON.stringify(opts ?? {})],
    calendarCacheOpts,
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
 * Purge the cheap feed aggregates (radar/pulse/top-topics/ticker). Called from
 * content-mutating cron route handlers (enrich / cluster / score-backfill /
 * normalize) after they change items/clusters/importance/tags, so the next
 * render recomputes fresh instead of waiting out FEED_CACHE_TTL. As of W9b those
 * crons purge CONDITIONALLY (only when the run actually changed content — see
 * _route.ts) so idle ticks preserve cache life.
 *
 * Deliberately does NOT purge FEED_CALENDAR_TAG — the calendar day-counts ride
 * their own 6h TTL (see module doc), so a content change is reflected on the
 * calendar within ≤6h, not on the next render. That decoupling is the point.
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
