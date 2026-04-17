/**
 * Local trigger for cron buckets — bypasses HTTP layer, calls workers directly.
 *
 * Usage:
 *   bun run cron:hourly
 *   bun run cron:daily
 *   bun run cron:normalize
 */

import { runFetchBucket } from "@/workers/fetcher";
import { runNormalizer } from "@/workers/normalizer";
import { runEnrichBatch } from "@/workers/enrich";
import { runClusterBatch } from "@/workers/cluster";
import { runArticleBodyFetch } from "@/workers/fetcher/article-body";

async function main() {
  const kind = process.argv[2];
  if (!kind) {
    console.error("usage: tsx scripts/ops/run-cron.ts {hourly|daily|weekly|normalize}");
    process.exit(2);
  }

  if (kind === "hourly") {
    const f = await runFetchBucket(["live", "hourly"]);
    const n = await runNormalizer();
    console.log(JSON.stringify({ fetch: f, normalize: n }, null, 2));
    return;
  }
  if (kind === "daily") {
    const f = await runFetchBucket(["daily"]);
    const n = await runNormalizer();
    console.log(JSON.stringify({ fetch: f, normalize: n }, null, 2));
    return;
  }
  if (kind === "weekly") {
    const f = await runFetchBucket(["weekly"]);
    const n = await runNormalizer();
    console.log(JSON.stringify({ fetch: f, normalize: n }, null, 2));
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
    const b = await runArticleBodyFetch();
    console.log(JSON.stringify({ body: b }, null, 2));
    return;
  }
  if (kind === "cluster") {
    const c = await runClusterBatch();
    console.log(JSON.stringify({ cluster: c }, null, 2));
    return;
  }

  console.error(`unknown kind: ${kind}`);
  process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
