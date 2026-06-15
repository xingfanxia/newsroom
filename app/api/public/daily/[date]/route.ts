/**
 * GET /api/public/daily/{YYYY-MM-DD} — Daily AI column for a specific date.
 *
 * Returns the column written for the 24h window whose period_start falls on
 * the requested UTC date. 404 if no column for that date.
 */
import {
  publicCachedRoute,
  publicRouteResult,
} from "@/lib/api/public-helpers";
import { getPublicDailyColumnByDateRequestPayload } from "@/lib/api/daily-columns";

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
      const result = await getPublicDailyColumnByDateRequestPayload(req, {
        rawDate,
      });
      return publicRouteResult(result, (payload) => ({
        signal: payload.etagSignal,
        body: payload.body,
      }));
    },
  });
}
