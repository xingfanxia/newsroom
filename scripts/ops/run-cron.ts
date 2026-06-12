/**
 * Local trigger for cron buckets — bypasses HTTP layer, calls workers directly.
 *
 * Usage:
 *   bun scripts/ops/run-cron.ts {hourly|daily|weekly|normalize|enrich|body|yt|cluster}
 */

import { runNormalizer } from "@/workers/normalizer";
import { runEnrichBatch } from "@/workers/enrich";
import { runClusterPipeline } from "@/workers/cluster/pipeline";
import { runFetchAndNormalize } from "@/workers/fetcher/pipeline";
import { runContentPrefetch } from "@/workers/fetcher/content-prefetch";
import { runYoutubeTranscriptFetch } from "@/workers/fetcher/youtube-transcript";

type CronKind =
  | "hourly"
  | "daily"
  | "weekly"
  | "normalize"
  | "enrich"
  | "body"
  | "yt"
  | "cluster";

type CronRunner = () => Promise<unknown>;

const CRON_RUNNERS = {
  hourly: () => runFetchAndNormalize(["live", "hourly"]),
  daily: () => runFetchAndNormalize(["daily"]),
  weekly: () => runFetchAndNormalize(["weekly"]),
  normalize: async () => ({ normalize: await runNormalizer() }),
  enrich: async () => ({ enrich: await runEnrichBatch() }),
  body: () => runContentPrefetch(),
  yt: async () => ({ youtube: await runYoutubeTranscriptFetch() }),
  cluster: () => runClusterPipeline(),
} satisfies Record<CronKind, CronRunner>;

const USAGE = `usage: bun scripts/ops/run-cron.ts {${Object.keys(CRON_RUNNERS).join("|")}}`;

function isCronKind(kind: string): kind is CronKind {
  return kind in CRON_RUNNERS;
}

async function main() {
  const kind = process.argv[2];
  if (!kind) {
    console.error(USAGE);
    process.exit(2);
  }

  if (!isCronKind(kind)) {
    console.error(`unknown kind: ${kind}`);
    console.error(USAGE);
    process.exit(2);
  }

  const report = await CRON_RUNNERS[kind]();
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
