import {
  runFetchAndNormalize,
  type FetchCadences,
} from "@/workers/fetcher/pipeline";
import { runCronJsonRoute } from "./_route";

type FetchCronKind = "fetch-hourly" | "fetch-daily" | "fetch-weekly";

export async function runFetchBucketCronRoute(
  req: Request,
  options: { kind: FetchCronKind; cadences: FetchCadences },
) {
  return runCronJsonRoute(req, async () => {
    const report = await runFetchAndNormalize(options.cadences);
    return {
      kind: options.kind,
      fetch: report.fetch,
      normalize: report.normalize,
    };
  });
}
