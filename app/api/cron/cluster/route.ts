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
    { revalidateFeed: true },
  );
}
