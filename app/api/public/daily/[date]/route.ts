/**
 * GET /api/public/daily/{YYYY-MM-DD} — Daily AI column for a specific date.
 *
 * Returns the column written for the 24h window whose period_start falls on
 * the requested UTC date. 404 if no column for that date.
 */
import { publicCachedRoute } from "@/lib/api/public-helpers";
import {
  dailyByDateSnapshotResult,
  readPublicSnapshot,
} from "@/lib/public-content/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ date: string }> },
) {
  return publicCachedRoute(req, {
    endpoint: "dailyByDate",
    etagFamily: "public-daily-date",
    label: "api/public/daily/:date",
    load: async () => {
      const { date: rawDate } = await ctx.params;
      return dailyByDateSnapshotResult(
        await readPublicSnapshot(),
        req,
        rawDate,
      );
    },
  });
}
