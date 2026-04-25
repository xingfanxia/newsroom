import { NextResponse } from "next/server";
import { runClusterBatch } from "@/workers/cluster";
import { runArbitrationBatch } from "@/workers/cluster/arbitrate";
import { runMergeBatch } from "@/workers/cluster/merge";
import { runCanonicalTitleBatch } from "@/workers/cluster/canonical-title";
import { runEventCommentaryBatch } from "@/workers/cluster/commentary";
import { verifyCron } from "../_auth";

// Merge-stage recency window. Each tick (every 30 min) only considers
// multi-member clusters whose latest_member_at is within the last 6h —
// keeps the pairwise-distance compute under ~1s on typical traffic.
// Operators can run scripts/migrations/merge-near-duplicate-clusters.ts
// with --hours 72 or --all for wider sweeps.
const MERGE_RECENCY_HOURS = 6;

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
  // Stage B+: merge near-duplicate multi-member clusters that Stage A's
  // greedy nearest-neighbor missed (typically because two same-source twins
  // arrived in the same batch and paired with each other before the older
  // cross-source cluster was indexed). Runs AFTER arbitrate so Stage B has
  // already split unrelated items out of any over-broad cluster — feeding
  // a cleaner pool into the merge candidate query. Survivor's verified_at
  // / titled_at / commentary_at are nulled on merge so the next tick re-
  // arbitrates / re-titles / re-comments with the larger pool.
  const merge = await safeStage("merge", () =>
    runMergeBatch({ recencyHours: MERGE_RECENCY_HOURS }),
  );
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
    merge,
    canonicalTitles,
    eventCommentary,
  });
}
