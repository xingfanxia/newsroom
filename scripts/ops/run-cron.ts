/**
 * Local trigger for cron buckets — bypasses HTTP layer, calls workers directly.
 *
 * Usage:
 *   bun scripts/ops/run-cron.ts {fetch-hourly|fetch-daily|...}
 *
 * Canonical keys mirror `vercel.json` cron route slugs. Short aliases are
 * kept for operator muscle memory (`hourly`, `body`, `score`, `yt`, ...).
 */

import { runNormalizer } from "@/workers/normalizer";
import { runEnrichBatch } from "@/workers/enrich";
import { runCommentaryBackfill } from "@/workers/enrich/commentary";
import { runScoreBackfill } from "@/workers/enrich/score-backfill";
import { runClusterPipeline } from "@/workers/cluster/pipeline";
import { runFetchCronBucket } from "@/workers/fetcher/pipeline";
import { runContentPrefetch } from "@/workers/fetcher/content-prefetch";
import { runYoutubeTranscriptFetch } from "@/workers/fetcher/youtube-transcript";
import { runDailyColumn, runNewsletterBatch } from "@/workers/newsletter";
import { runNewsletterSend } from "@/workers/newsletter/send";
import { runIncrementalPublicPublisher } from "@/lib/public-content/publisher/runtime";

type CronRunner = () => Promise<unknown>;

const fetchHourly = () => runFetchCronBucket("fetch-hourly");
const fetchDaily = () => runFetchCronBucket("fetch-daily");
const fetchWeekly = () => runFetchCronBucket("fetch-weekly");
const contentPrefetch = () => runContentPrefetch();
const youtubeTranscript = async () => ({
  youtube: await runYoutubeTranscriptFetch(),
});

export const CRON_RUNNERS = {
  "fetch-hourly": fetchHourly,
  "fetch-daily": fetchDaily,
  "fetch-weekly": fetchWeekly,
  "normalize": async () => ({ normalize: await runNormalizer() }),
  "article-body": contentPrefetch,
  "enrich": async () => ({ enrich: await runEnrichBatch() }),
  "commentary": async () => ({ commentary: await runCommentaryBackfill() }),
  "score-backfill": async () => ({ score: await runScoreBackfill() }),
  "cluster": () => runClusterPipeline(),
  "newsletter-daily": async () => ({ report: await runDailyColumn() }),
  // NEWSLETTER_SEND_DRY_RUN=1 renders + counts without network/ledger.
  "newsletter-send": async () => ({
    send: await runNewsletterSend({
      dryRun: process.env.NEWSLETTER_SEND_DRY_RUN === "1",
    }),
  }),
  "newsletter-monthly": async () => ({
    newsletter: await runNewsletterBatch("monthly"),
  }),
  "publish-public": runIncrementalPublicPublisher,
  "youtube-transcript": youtubeTranscript,
} satisfies Record<string, CronRunner>;

type CronKind = keyof typeof CRON_RUNNERS;

const CRON_ALIASES = {
  hourly: "fetch-hourly",
  daily: "fetch-daily",
  weekly: "fetch-weekly",
  body: "article-body",
  score: "score-backfill",
  yt: "youtube-transcript",
} satisfies Record<string, CronKind>;

const USAGE_KINDS = [
  ...Object.keys(CRON_RUNNERS),
  ...Object.keys(CRON_ALIASES),
].sort();
const USAGE = `usage: bun scripts/ops/run-cron.ts {${USAGE_KINDS.join("|")}}`;

export function resolveCronKind(kind: string): CronKind | null {
  if (kind in CRON_RUNNERS) return kind as CronKind;
  return (CRON_ALIASES as Record<string, CronKind>)[kind] ?? null;
}

async function main() {
  const kind = process.argv[2];
  if (!kind) {
    console.error(USAGE);
    process.exit(2);
  }

  const resolved = resolveCronKind(kind);
  if (!resolved) {
    console.error(`unknown kind: ${kind}`);
    console.error(USAGE);
    process.exit(2);
  }

  const report = await CRON_RUNNERS[resolved]();
  console.log(JSON.stringify(report, null, 2));
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
