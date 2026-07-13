import { unstable_cache } from "next/cache";
import { renderLegacyRssFeed } from "@/lib/rss/legacy-feeds";
import type { LegacyRssSlug } from "@/lib/rss/legacy-feed-meta";

/**
 * Read-budget cache (W9c-3) for the legacy per-source RSS feeds. The route
 * (/api/rss/[slug]) is force-dynamic because it runs a per-request rate-limiter,
 * so it can't use route-level `revalidate` like the main / newsletter RSS — cache
 * the render at the DATA layer here instead, keeping the limiter per-request.
 *
 * The CURATED lane is the motivating cost: with a single curated source (1 of 55
 * on prod), `ORDER BY published_at DESC LIMIT 50` filtered post-JOIN to that one
 * source can walk the FULL items index (~21.6k rows) to accumulate 50 — the same
 * unbounded-scan class the main RSS hit before its W9c-1 floor. Non-breaking: RSS
 * is recent-by-nature and 10-min staleness matches the main/newsletter RSS
 * `revalidate=600`. Own `legacy-rss` tag, NOT cron-purged (pure TTL is the
 * strongest db-load bound); exported for manual/admin purge.
 *
 * Split into its own module (not folded into legacy-feeds.ts) so the cache adapter
 * is separable from the pure render — and so tests can stub renderLegacyRssFeed via
 * this module's import boundary WITHOUT globally mocking @/db/client (which would
 * poison every real-DB test in the process). The `unstable_cache` wrapper is built
 * PER CALL (see feed-results.ts): its Data Cache key is
 * `cb.toString()+keyParts+JSON.stringify(args)`, independent of wrapper identity, so
 * per-call construction is prod-identical to a module-scope singleton AND
 * re-mockable. slug is the arg → keyed distinctly per lane (today / curated / daily).
 *
 * REQUEST-SCOPE COUPLING (see feed-results.ts): `unstable_cache` throws
 * `Invariant: incrementalCache missing` outside an app-router request. The only
 * caller is the request-scoped RSS route — do NOT reuse in a cron/worker/script.
 *
 * SECURITY: unlike the feed/search caches, this render has NO caller-identity
 * dimension — fixed public locale + a server-side `s.curated` filter, no
 * auth/tier — so the shared-entry hazard the peer modules warn about cannot arise.
 * Do NOT introduce a caller-dependent branch inside renderLegacyRssFeed.
 */
export const LEGACY_RSS_CACHE_TAG = "legacy-rss";
const LEGACY_RSS_CACHE_TTL = 600;

export function renderLegacyRssFeedCached(
  slug: LegacyRssSlug,
): Promise<string> {
  return unstable_cache(renderLegacyRssFeed, ["legacy-rss:v1"], {
    revalidate: LEGACY_RSS_CACHE_TTL,
    tags: [LEGACY_RSS_CACHE_TAG],
  })(slug);
}
