import { NextResponse } from "next/server";
import { runClusterBatch } from "@/workers/cluster";
import { verifyCron } from "../_auth";

export const maxDuration = 800;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const deny = verifyCron(req);
  if (deny) return deny;

  const report = await runClusterBatch();
  return NextResponse.json({
    kind: "cluster",
    at: new Date().toISOString(),
    cluster: report,
  });
}
