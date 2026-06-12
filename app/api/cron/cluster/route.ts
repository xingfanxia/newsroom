import { NextResponse } from "next/server";
import { runClusterPipeline } from "@/workers/cluster/pipeline";
import { verifyCron } from "../_auth";

export const maxDuration = 800;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const deny = verifyCron(req);
  if (deny) return deny;

  const report = await runClusterPipeline();

  return NextResponse.json({
    kind: "cluster",
    at: new Date().toISOString(),
    cluster: report.cluster,
    singletonRecluster: report.singletonRecluster,
    arbitrate: report.arbitrate,
    merge: report.merge,
    canonicalTitles: report.canonicalTitles,
    eventCommentary: report.eventCommentary,
  });
}
