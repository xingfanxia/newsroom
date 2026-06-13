/**
 * GET /api/public/daily/{YYYY-MM-DD} — Daily AI column for a specific date.
 *
 * Returns the column written for the 24h window whose period_start falls on
 * the requested UTC date. 404 if no column for that date.
 */
import {
  publicCachedJson,
  publicEndpointRateLimit,
  publicError,
  publicServerError,
} from "@/lib/api/public-helpers";
import { getPublicDailyColumnByDateRequestPayload } from "@/lib/api/daily-columns";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ date: string }> },
) {
  const limited = publicEndpointRateLimit(req, "dailyByDate");
  if (limited) return limited;

  const { date: rawDate } = await ctx.params;

  try {
    const result = await getPublicDailyColumnByDateRequestPayload(req, {
      rawDate,
    });
    if (!result.ok) return publicError(result.error, result.status);

    // Historical dailies are immutable — aggressive cache.
    return publicCachedJson(req, {
      endpoint: "dailyByDate",
      etagFamily: "public-daily-date",
      signal: result.payload.etagSignal,
      body: result.payload.body,
    });
  } catch (err) {
    return publicServerError("api/public/daily/:date", err);
  }
}
