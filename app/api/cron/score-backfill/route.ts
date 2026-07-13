import { runScoreBackfill } from "@/workers/enrich/score-backfill";
import { runCronJsonRoute } from "../_route";

// Score-only backfill — picks items that were enriched before HKR was
// part of the schema (or before the bilingual reasoning columns landed)
// and re-runs the score stage. Mostly idle once the legacy pool is
// drained. Hourly cadence is plenty for a backfill worker.
export const maxDuration = 800;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  return runCronJsonRoute(
    req,
    async () => ({
      kind: "score-backfill",
      score: await runScoreBackfill(),
    }),
    { revalidateFeed: true },
  );
}
