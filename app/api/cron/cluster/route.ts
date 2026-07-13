import { runClusterPipeline } from "@/workers/cluster/pipeline";
import { runCronJsonRoute } from "../_route";

export const maxDuration = 800;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  return runCronJsonRoute(
    req,
    async () => {
      const report = await runClusterPipeline();
      return {
        kind: "cluster",
        cluster: report.cluster,
        singletonRecluster: report.singletonRecluster,
        arbitrate: report.arbitrate,
        merge: report.merge,
        canonicalTitles: report.canonicalTitles,
        eventCommentary: report.eventCommentary,
      };
    },
    // Unconditional: the pipeline has 7 heterogeneous stages (any of grouping /
    // merge / retitle / commentary reshapes the rendered feed), so a reliable
    // "changed" predicate would have to inspect all of them — fragile. Since W9a
    // this runs only 3×/day and, on a daily-update site, ~always does real work,
    // so always-purge costs little and can't miss a mutation.
    { revalidateFeed: true },
  );
}
