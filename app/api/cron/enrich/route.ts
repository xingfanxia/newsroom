import { NextResponse } from "next/server";
import { runEnrichBatch } from "@/workers/enrich";
import { verifyCron } from "../_auth";

// Stages 1+2+3 (summary/tags → embed → score) for unenriched items.
// Article-body prefetch, score-backfill, and commentary now have their
// own cron routes — when they were chained here, each tick's effective
// budget was eaten by whichever ran first, capping enrich at ~1 item
// per tick on live data. Splitting gives each worker a fresh Vercel
// function invocation.
export const maxDuration = 800;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const deny = verifyCron(req);
  if (deny) return deny;

  const enrich = await runEnrichBatch();
  return NextResponse.json({
    kind: "enrich",
    at: new Date().toISOString(),
    enrich,
  });
}
