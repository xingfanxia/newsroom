import { NextResponse } from "next/server";
import { runClusterBatch } from "@/workers/cluster";
import { runArbitrationBatch } from "@/workers/cluster/arbitrate";
import { runCanonicalTitleBatch } from "@/workers/cluster/canonical-title";
import { runEventCommentaryBatch } from "@/workers/cluster/commentary";
import { verifyCron } from "../_auth";

export const maxDuration = 800;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const deny = verifyCron(req);
  if (deny) return deny;

  // Stage A: assign unclustered items to nearest-neighbor clusters.
  const cluster = await runClusterBatch();
  // Stage B: Haiku arbitrator decides keep-or-split for unverified clusters.
  // Locks survivors via verified_at + cluster_verified_at so Stage A won't
  // re-merge what was split.
  const arbitrate = await runArbitrationBatch();
  // Stage C: neutral canonical titles for multi-member clusters.
  const canonicalTitles = await runCanonicalTitleBatch();
  // Stage D: event-level editorial commentary for featured/p1 events.
  const eventCommentary = await runEventCommentaryBatch();

  return NextResponse.json({
    kind: "cluster",
    at: new Date().toISOString(),
    cluster,
    arbitrate,
    canonicalTitles,
    eventCommentary,
  });
}
