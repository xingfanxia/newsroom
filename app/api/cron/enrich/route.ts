import { NextResponse } from "next/server";
import { runEnrichBatch } from "@/workers/enrich";
import { verifyCron } from "../_auth";

export const maxDuration = 800;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const deny = verifyCron(req);
  if (deny) return deny;

  const report = await runEnrichBatch();
  return NextResponse.json({
    kind: "enrich",
    at: new Date().toISOString(),
    enrich: report,
  });
}
