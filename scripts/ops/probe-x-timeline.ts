#!/usr/bin/env bun
/**
 * Dev probe — pulls one handle's recent original tweets via the X API v2
 * adapter without touching the fetcher/normalizer pipeline. Lets us verify
 * auth + mapping + filtering in isolation before running the full cron.
 *
 * Usage: `bun --env-file=.env.local scripts/ops/probe-x-timeline.ts [handle]`
 *        (defaults to dotey)
 */
import { fetchTimelineForHandle } from "@/workers/fetcher/x-api";
import { closeDb } from "@/db/client";

const handle = process.argv[2] ?? "dotey";

console.log(`probing X timeline for @${handle}…`);
const started = Date.now();
try {
  const { items, newestId } = await fetchTimelineForHandle({
    handle,
    maxResults: 10,
  });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n=== fetched ${items.length} tweet(s) in ${elapsed}s — newest_id=${newestId} ===`);
  for (const it of items) {
    const body = (it.rawPayload as { body: string }).body;
    const isLong = body.length > 280;
    console.log(
      `\n  [${it.externalId}] ${it.publishedAt?.toISOString().slice(0, 16) ?? "?"} ${isLong ? "📜" : ""} ${it.url}`,
    );
    console.log(`    title: ${it.title}`);
    console.log(`    body (${body.length} chars): ${body.slice(0, 180).replace(/\n/g, " ⏎ ")}`);
  }
} finally {
  await closeDb();
}
