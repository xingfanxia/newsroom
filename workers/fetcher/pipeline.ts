import { runFetchBucket, type FetchReport } from "@/workers/fetcher";
import { runNormalizer, type NormalizeReport } from "@/workers/normalizer";
import type { Cadence } from "@/lib/types";

type FetchCadences = Parameters<typeof runFetchBucket>[0];
export type FetchCronKind = "fetch-hourly" | "fetch-daily" | "fetch-weekly";

const FETCH_CRON_CADENCES = {
  "fetch-hourly": ["live", "hourly"],
  "fetch-daily": ["daily"],
  "fetch-weekly": ["weekly"],
} as const satisfies Record<FetchCronKind, readonly Cadence[]>;

function fetchCronCadences(kind: FetchCronKind): FetchCadences {
  return [...FETCH_CRON_CADENCES[kind]];
}

export type FetchAndNormalizeReport = {
  fetch: FetchReport;
  normalize: NormalizeReport;
};

async function runFetchAndNormalize(
  cadences: FetchCadences,
): Promise<FetchAndNormalizeReport> {
  const fetch = await runFetchBucket(cadences);
  const normalize = await runNormalizer();

  return { fetch, normalize };
}

export function runFetchCronBucket(
  kind: FetchCronKind,
): Promise<FetchAndNormalizeReport> {
  return runFetchAndNormalize(fetchCronCadences(kind));
}
