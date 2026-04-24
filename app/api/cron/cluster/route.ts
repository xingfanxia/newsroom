import { NextResponse } from "next/server";
import { runClusterBatch } from "@/workers/cluster";
import { runArbitrationBatch } from "@/workers/cluster/arbitrate";
import { runCanonicalTitleBatch } from "@/workers/cluster/canonical-title";
import { runEventCommentaryBatch } from "@/workers/cluster/commentary";
import { verifyCron } from "../_auth";

export const maxDuration = 800;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type StageResult<T> = T | { stage: string; error: string };

/**
 * Run a stage and convert thrown errors into structured failure stubs so
 * downstream stages can still execute and the cron response stays a 200
 * with per-stage status. A single stage failure (DB hiccup, LLM timeout)
 * shouldn't cascade and skip the rest of the pipeline — each stage's
 * candidate query is independent.
 */
async function safeStage<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<StageResult<T>> {
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[cron/cluster] ${name} failed:`, err);
    return { stage: name, error: message };
  }
}

export async function GET(req: Request) {
  const deny = verifyCron(req);
  if (deny) return deny;

  // Stage A: assign unclustered items to nearest-neighbor clusters.
  const cluster = await safeStage("cluster", () => runClusterBatch());
  // Stage B: Haiku arbitrator decides keep-or-split for unverified clusters.
  // Locks survivors via verified_at + cluster_verified_at so Stage A won't
  // re-merge what was split.
  const arbitrate = await safeStage("arbitrate", () => runArbitrationBatch());
  // Stage C: neutral canonical titles for multi-member clusters.
  const canonicalTitles = await safeStage("canonical-title", () =>
    runCanonicalTitleBatch(),
  );
  // Stage D: event-level editorial commentary for featured/p1 events.
  const eventCommentary = await safeStage("event-commentary", () =>
    runEventCommentaryBatch(),
  );

  return NextResponse.json({
    kind: "cluster",
    at: new Date().toISOString(),
    cluster,
    arbitrate,
    canonicalTitles,
    eventCommentary,
  });
}
