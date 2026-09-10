/**
 * Recover AI HOT curated items after a cron outage. The hourly fetcher reads a
 * single `mode=selected&take=50` page, so items older than that page are never
 * fetched; this pages back with `since` (the API honors up to 7 days) through
 * the same paper filter + raw_items insert as workers/fetcher/aihot.ts.
 * Duplicates are skipped by the (source_id, external_id) conflict target.
 *
 * Run:   bun --env-file=.env.local scripts/ops/backfill-aihot-since.ts 2026-09-06T00:00:00Z
 * Then drain normalize → article-body → enrich (docs/operations/production-monitoring.md).
 */
import { closeDb } from "@/db/client";
import { insertRawItems } from "@/lib/backfill/runner";
import { aihotItemToFeedItem, fetchAllItems } from "@/lib/sources/aihot";

const SOURCE_ID = "aihot-selected";

async function main() {
  const since = process.argv[2];
  if (!since || Number.isNaN(Date.parse(since))) {
    throw new Error("usage: backfill-aihot-since.ts <ISO-8601 since, within 7 days>");
  }
  const raw = await fetchAllItems({ mode: "selected", since, take: 100, maxItems: 500 });
  const feedItems = raw
    .filter((item) => item.category !== "paper")
    .map(aihotItemToFeedItem)
    .filter((item): item is NonNullable<typeof item> => item !== null);
  const inserted = await insertRawItems(SOURCE_ID, feedItems);
  console.log(JSON.stringify({ since, fetched: raw.length, candidates: feedItems.length, inserted }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(closeDb);
