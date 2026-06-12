import { runClusterBatch, type ClusterReport } from "@/workers/cluster";
import {
  runArbitrationBatch,
  type ArbitrationReport,
} from "@/workers/cluster/arbitrate";
import {
  runCanonicalTitleBatch,
  type CanonicalTitleReport,
} from "@/workers/cluster/canonical-title";
import {
  runEventCommentaryBatch,
  type EventCommentaryReport,
} from "@/workers/cluster/commentary";
import { runMergeBatch, type MergeReport } from "@/workers/cluster/merge";
import {
  runSingletonReclusterBatch,
  type SingletonReclusterReport,
} from "@/workers/cluster/singletons";

// Merge-stage recency window. Each tick only considers multi-member clusters
// whose latest_member_at is within the last 6h, keeping pairwise distance
// checks cheap. Wider manual sweeps belong in scripts/migrations.
const MERGE_RECENCY_HOURS = 6;
const SINGLETON_RECLUSTER_RECENCY_HOURS = 72;

type ClusterPipelineStageError = { stage: string; error: string };
type ClusterPipelineStage<T> = T | ClusterPipelineStageError;

export type ClusterPipelineReport = {
  cluster: ClusterPipelineStage<ClusterReport>;
  singletonRecluster: ClusterPipelineStage<SingletonReclusterReport>;
  arbitrate: ClusterPipelineStage<ArbitrationReport>;
  merge: ClusterPipelineStage<MergeReport>;
  canonicalTitles: ClusterPipelineStage<CanonicalTitleReport>;
  eventCommentary: ClusterPipelineStage<EventCommentaryReport>;
};

/**
 * Run a stage and convert thrown errors into structured failure stubs so
 * downstream stages can still execute. A single DB hiccup or LLM timeout
 * should not block independent later stages from making progress.
 */
async function safeStage<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<ClusterPipelineStage<T>> {
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[cluster/pipeline] ${name} failed:`, err);
    return { stage: name, error: message };
  }
}

export async function runClusterPipeline(): Promise<ClusterPipelineReport> {
  // Stage A: assign unclustered items to nearest-neighbor clusters.
  const cluster = await safeStage("cluster", () => runClusterBatch());

  // Stage A.5: recheck recent singleton clusters that Stage A will never see
  // again (`clustered_at IS NULL` no longer holds).
  const singletonRecluster = await safeStage("singleton-recluster", () =>
    runSingletonReclusterBatch({
      recencyHours: SINGLETON_RECLUSTER_RECENCY_HOURS,
    }),
  );

  // Stage B: LLM arbitrator decides keep-or-split for unverified clusters.
  const arbitrate = await safeStage("arbitrate", () => runArbitrationBatch());

  // Stage B+: merge near-duplicate multi-member clusters after arbitration
  // has split unrelated provisional members out of the candidate pool.
  const merge = await safeStage("merge", () =>
    runMergeBatch({ recencyHours: MERGE_RECENCY_HOURS }),
  );

  // Stage C: neutral canonical titles for multi-member clusters.
  const canonicalTitles = await safeStage("canonical-title", () =>
    runCanonicalTitleBatch(),
  );

  // Stage D: event-level editorial commentary for non-excluded events.
  const eventCommentary = await safeStage("event-commentary", () =>
    runEventCommentaryBatch(),
  );

  return {
    cluster,
    singletonRecluster,
    arbitrate,
    merge,
    canonicalTitles,
    eventCommentary,
  };
}
