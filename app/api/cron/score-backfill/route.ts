import { runScoreBackfill } from "@/workers/enrich/score-backfill";
import { runCronJsonRoute } from "../_route";

// Score-only backfill — picks items that were enriched before HKR was
// part of the schema (or before the bilingual reasoning columns landed)
// and re-runs the score stage. Mostly idle once the legacy pool is
// drained. Weekly cadence (W9a: 25 6 * * 1) is plenty — the pre-rubric
// pool is drained, so an hourly full-scan found 0 work every tick.
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
    // The legacy pool is drained, so nearly every weekly run rescores 0 — purge
    // only when it actually re-scored something.
    { revalidateFeed: (b) => b.score.rescored > 0 },
  );
}
