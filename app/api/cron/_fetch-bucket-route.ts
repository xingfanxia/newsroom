import {
  runFetchCronBucket,
  type FetchCronKind,
} from "@/workers/fetcher/pipeline";
import { runCronJsonRoute } from "./_route";

export async function runFetchBucketCronRoute(
  req: Request,
  kind: FetchCronKind,
) {
  return runCronJsonRoute(req, async () => {
    const report = await runFetchCronBucket(kind);
    return {
      kind,
      fetch: report.fetch,
      normalize: report.normalize,
    };
  });
}
