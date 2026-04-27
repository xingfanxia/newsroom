import { NextResponse } from "next/server";
import { runScoreBackfill } from "@/workers/enrich/score-backfill";
import { verifyCron } from "../_auth";

// Score-only backfill — picks items that were enriched before HKR was
// part of the schema (or before the bilingual reasoning columns landed)
// and re-runs the score stage. Mostly idle once the legacy pool is
// drained. Hourly cadence is plenty for a backfill worker.
export const maxDuration = 800;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const deny = verifyCron(req);
  if (deny) return deny;

  const score = await runScoreBackfill();
  return NextResponse.json({
    kind: "score-backfill",
    at: new Date().toISOString(),
    score,
  });
}
