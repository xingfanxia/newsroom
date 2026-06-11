/**
 * AI HOT (https://aihot.virxact.com) fetcher adapter.
 *
 * Wraps lib/sources/aihot.ts so the existing per-source fetcher dispatch in
 * workers/fetcher/index.ts can call it the same way it calls fetchTimelineForHandle
 * for x-api kind. Returns the same FeedItem[] + newestId shape as x-api.ts so
 * the dispatch code path is uniform.
 *
 * Cost & cursor model:
 * - AI HOT items API is anonymous. We pull `mode=selected` (~50 items, their
 *   curated pool) on every hourly tick. The DB unique index on
 *   (source_id, external_id) deduplicates re-seen items, so we do NOT use
 *   cursor pagination here — re-fetching the same 50 items each hour is cheap
 *   (well under their 600 req/min limit).
 * - source_health.last_external_id is updated to the newest item's id but is
 *   informational only; we don't pass it back as a query parameter.
 *
 * Graceful degradation: any AihotError bubbles up to fetchOneSource where it
 * gets mapped to source_health.status='error'. AI HOT API outage doesn't
 * cascade — the next tick retries cleanly.
 */
import { fetchItems, aihotItemToFeedItem, AihotError } from "@/lib/sources/aihot";
import type { FeedItem } from "./rss";

export type AihotFetchResult = {
  items: FeedItem[];
  newestId: string | null;
};

/**
 * One-shot fetch of the AI HOT 'selected' pool for a single source.
 *
 * The source row's `url` field is ignored (we always hit the same endpoint
 * via the env-configured base URL). Future per-source URL routing — e.g.
 * separate sources for different categories or for `mode=all` — would
 * branch on source.id and pass different params to fetchItems.
 */
export async function fetchAihotForSource(input: {
  sourceId: string;
}): Promise<AihotFetchResult> {
  // Branch by source id so we can later register additional AI HOT sources
  // (mode=all, category-filtered) without adding a new fetcher.
  const params = paramsForSource(input.sourceId);

  const response = await fetchItems(params);

  const feedItems: FeedItem[] = [];
  for (const item of response.items) {
    if (item.category === "paper") continue;
    const fi = aihotItemToFeedItem(item);
    if (fi) feedItems.push(fi);
  }

  // Newest id = first item in the response (their API returns publishedAt DESC
  // by default for both selected and all modes). Defensive: empty page → null.
  const newestId = feedItems.length > 0 ? feedItems[0]!.externalId : null;

  return { items: feedItems, newestId };
}

/** Map a source id to AI HOT API params. Add new ids here as we register them. */
function paramsForSource(
  sourceId: string,
): Parameters<typeof fetchItems>[0] {
  switch (sourceId) {
    case "aihot-selected":
      // Their daily-curated pool — what most readers want.
      return { mode: "selected", take: 50 };
    case "aihot-all":
      // Full firehose. Higher noise; we'd treat as priority=3 if/when registered.
      return { mode: "all", take: 50 };
    default:
      // Unknown id — fall back to selected. Logs a soft warning so we can
      // catch typos in the catalog without breaking the tick.
      console.warn(
        `[aihot-fetcher] unknown source id "${sourceId}" — defaulting to mode=selected`,
      );
      return { mode: "selected", take: 50 };
  }
}

// Re-export for the dispatcher's error-mapping branch.
export { AihotError };
