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

const USAGE =
  "usage: bun scripts/ops/run-cron.ts {hourly|daily|weekly|normalize|enrich|body|yt|cluster}";

async function main() {
  const kind = process.argv[2];
  if (!kind) {
    console.error(USAGE);
    process.exit(2);
  }

  if (kind === "hourly") {
    const report = await runFetchAndNormalize(["live", "hourly"]);
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (kind === "daily") {
    const report = await runFetchAndNormalize(["daily"]);
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (kind === "weekly") {
    const report = await runFetchAndNormalize(["weekly"]);
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (kind === "normalize") {
    const n = await runNormalizer();
    console.log(JSON.stringify({ normalize: n }, null, 2));
    return;
  }
  if (kind === "enrich") {
    const e = await runEnrichBatch();
    console.log(JSON.stringify({ enrich: e }, null, 2));
    return;
  }
  if (kind === "body") {
    const report = await runContentPrefetch();
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (kind === "yt") {
    const y = await runYoutubeTranscriptFetch();
    console.log(JSON.stringify({ youtube: y }, null, 2));
    return;
  }
  if (kind === "cluster") {
    const c = await runClusterPipeline();
    console.log(JSON.stringify(c, null, 2));
    return;
  }

  console.error(`unknown kind: ${kind}`);
  process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
