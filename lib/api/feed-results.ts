import { unstable_cache } from "next/cache";
import {
  countFeaturedStories,
  getFeaturedStories,
  type FeedQuery,
} from "@/lib/items/live";
import {
  DEFAULT_FEED_LIMIT,
  DEFAULT_FEED_OFFSET,
  DEFAULT_FEED_VIEW,
} from "@/lib/feed/query-defaults";
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
 * Read-budget cache (W9c-2) for the JSON feed surfaces. Unlike the home pages
 * (recency-floored) and RSS (floored in W9c-1), the public/v1 feed routes are
 * force-dynamic + UNCACHED and MUST stay all-time / fully paginable — a default
 * floor would break their API contract. So we bound them WITHOUT changing the
 * contract: dedupe identical (param-keyed) executions behind a 10-min TTL.
 *
 * Each uncached call runs getFeaturedStories + countFeaturedStories (~43K rows on
 * prod); a poller hitting a hot param combo once/min would cost ~2.6M reads/h.
 * Cached, that hot combo costs ~1 DB execution per TTL (modulo a small
 * thundering-herd at the refresh boundary — background-revalidation dedup keys on
 * the per-request work store, so N requests hitting a freshly-stale entry can each
 * spawn one refresh). `unstable_cache` is stale-while-revalidate: past the ~10-min
 * TTL the triggering request is served the stale value while a background
 * revalidation refreshes. PURE TTL (not cron-purged): a programmatic feed API
 * tolerates ~10-min staleness (same as the RSS feed's revalidate=600), and a hard
 * TTL is the strongest db-load bound — a cron-purged tag would reprime on every
 * content change and weaken it. FEED_API_CACHE_TAG is exported for manual/admin
 * purge; the content crons deliberately do NOT purge it.
 *
 * FRESHNESS TRADEOFF (intended, and the tradeoff AX signed off on): the DATA
 * contract — shape, totals, pagination — is unchanged, but freshness degrades ≤10
 * min. Newly-ingested items are invisible to the JSON APIs for up to a TTL (crons
 * don't purge these tags), and now-derived fields (view=today's importance-hot
 * ordering, stillDeveloping) freeze for the TTL. Acceptable on a daily-cadence
 * radar and consistent with the RSS/home tolerances; view=today is the most
 * staleness-visible surface, so revisit its TTL first if that ever bites.
 *
 * REQUEST-SCOPE COUPLING: runFeedQuery/runSearchQuery are no longer context-free —
 * `unstable_cache` throws `Invariant: incrementalCache missing` outside an
 * app-router request. All callers today are request-scoped route handlers; do NOT
 * reuse these in a cron/worker/script without a next/cache shim.
 */
export const FEED_API_CACHE_TAG = "feed-api";
const FEED_API_CACHE_TTL = 600;

// SECURITY INVARIANT: this cache entry is SHARED across public / v1 / MCP (they
// all call runFeedQuery with the same cb + keyParts, and identical params share an
// entry). It is safe ONLY because every caller-visibility difference is expressed
// via key-included params (tier/limit/locale) or POST-cache projection
// (toPublicApiItem vs toAgentApiItem) — executeFeedQuery takes no caller identity.
// Do NOT add caller-privilege-dependent row filtering in here; it would leak across
// surfaces on a cache hit. Gate exposure in the route adapter or via a keyed param.
async function executeFeedQuery(
  feedQuery: FeedQuery,
): Promise<FeedExecutionResult> {
  const [items, total] = await Promise.all([
    getFeaturedStories(feedQuery),
    countFeaturedStories(feedQuery),
  ]);

  return {
    items,
    total,
    limit: feedQuery.limit ?? DEFAULT_FEED_LIMIT,
    offset: feedQuery.offset ?? DEFAULT_FEED_OFFSET,
    view: feedQuery.view ?? DEFAULT_FEED_VIEW,
  };
}

/**
 * Shared feed execution for REST feed routes and MCP ax_radar_feed.
 * Surface adapters own auth/rate-limit/envelopes; this module owns the paired
 * item + total query, the read-budget cache, and payload mapping so pagination
 * and exposure semantics cannot drift.
 *
 * The `unstable_cache` wrapper is built PER CALL (not once at module scope), like
 * feed-cache.ts's arg-taking readers — but via a DIFFERENT keying mechanism: those
 * wrap a zero-arg closure and fold runtime args into `keyParts` by hand, whereas
 * this passes feedQuery AS THE ARG and relies on unstable_cache appending
 * `JSON.stringify(args)` to the key itself (see feed-cache.ts's module doc for the
 * two styles). Its Data Cache key is `cb.toString() + keyParts + JSON.stringify(args)`,
 * independent of the wrapper object's identity, so rebuilding it each call is
 * behaviourally identical to a module-scope singleton (no lost hits, one closure
 * alloc/call). So each distinct param set (tier / view / limit / offset / filters /
 * locale) is its own entry — pagination pages and filtered slices never collide.
 * feedQueryFromParams builds the object with a fixed key order, so identical
 * requests serialize identically → the same entry. The result is JSON-safe (Story
 * dates are ISO strings), so the round-trip preserves types.
 */
export function runFeedQuery(
  feedQuery: FeedQuery,
): Promise<FeedExecutionResult> {
  return unstable_cache(executeFeedQuery, ["feed-api:v1"], {
    revalidate: FEED_API_CACHE_TTL,
    tags: [FEED_API_CACHE_TAG],
  })(feedQuery);
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
