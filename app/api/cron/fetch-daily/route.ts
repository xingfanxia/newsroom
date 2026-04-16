import { NextResponse } from "next/server";
import { runFetchBucket } from "@/workers/fetcher";
import { runNormalizer } from "@/workers/normalizer";
import { verifyCron } from "../_auth";

export const maxDuration = 800;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const deny = verifyCron(req);
  if (deny) return deny;

  const fetchReport = await runFetchBucket(["daily"]);
  const normalizeReport = await runNormalizer();

  return NextResponse.json({
    kind: "fetch-daily",
    at: new Date().toISOString(),
    fetch: fetchReport,
    normalize: normalizeReport,
  });
}
