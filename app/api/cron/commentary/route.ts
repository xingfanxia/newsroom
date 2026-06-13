import { runCommentaryBackfill } from "@/workers/enrich/commentary";
import { runCronJsonRoute } from "../_route";

// Item-level editor-note / analysis backfill — runs against featured/p1
// items with `enriched_at IS NOT NULL`. Each call is ~30-40s of standard
// reasoning, so it gets its own function so the longer wall clock per
// item doesn't starve /api/cron/enrich's per-tick budget.
export const maxDuration = 800;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  return runCronJsonRoute(req, async () => ({
    kind: "commentary",
    commentary: await runCommentaryBackfill(),
  }));
}
