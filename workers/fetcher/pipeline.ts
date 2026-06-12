import { runFetchBucket, type FetchReport } from "@/workers/fetcher";
import { runNormalizer, type NormalizeReport } from "@/workers/normalizer";

export type FetchCadences = Parameters<typeof runFetchBucket>[0];

export type FetchAndNormalizeReport = {
  fetch: FetchReport;
  normalize: NormalizeReport;
};

export async function runFetchAndNormalize(
  cadences: FetchCadences,
): Promise<FetchAndNormalizeReport> {
  const fetch = await runFetchBucket(cadences);
  const normalize = await runNormalizer();

  return { fetch, normalize };
}
