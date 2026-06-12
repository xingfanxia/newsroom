import { NextResponse } from "next/server";
import { runFetchBucket } from "@/workers/fetcher";
import { runNormalizer } from "@/workers/normalizer";
import { verifyCron } from "./_auth";

type FetchCronKind = "fetch-hourly" | "fetch-daily" | "fetch-weekly";
type FetchCadences = Parameters<typeof runFetchBucket>[0];

export async function runFetchBucketCronRoute(
  req: Request,
  options: { kind: FetchCronKind; cadences: FetchCadences },
) {
  const deny = verifyCron(req);
  if (deny) return deny;

  const fetchReport = await runFetchBucket(options.cadences);
  const normalizeReport = await runNormalizer();

  return NextResponse.json({
    kind: options.kind,
    at: new Date().toISOString(),
    fetch: fetchReport,
    normalize: normalizeReport,
  });
}
