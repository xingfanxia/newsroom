import { NextResponse } from "next/server";
import {
  runFetchAndNormalize,
  type FetchCadences,
} from "@/workers/fetcher/pipeline";
import { verifyCron } from "./_auth";

type FetchCronKind = "fetch-hourly" | "fetch-daily" | "fetch-weekly";

export async function runFetchBucketCronRoute(
  req: Request,
  options: { kind: FetchCronKind; cadences: FetchCadences },
) {
  const deny = verifyCron(req);
  if (deny) return deny;

  const report = await runFetchAndNormalize(options.cadences);

  return NextResponse.json({
    kind: options.kind,
    at: new Date().toISOString(),
    fetch: report.fetch,
    normalize: report.normalize,
  });
}
