/**
 * GET /api/public/daily — Latest daily AI column (卡兹克-voice).
 *
 * Latest row from `newsletters` where kind='daily' AND column_title IS NOT NULL.
 * Cron writes one per day at ~9pm PT. Returns the column body: title +
 * theme tag + numbered exec summary (1-5 items, each w/ [#item-id] backlinks)
 * + 2000-4000 字 long-form narrative.
 *
 * locale=zh default. The daily-column worker currently writes zh rows.
 */
import {
  publicCachedJson,
  publicEndpointRateLimit,
  publicError,
  publicServerError,
} from "@/lib/api/public-helpers";
import { getLatestPublicDailyColumnRequestPayload } from "@/lib/api/daily-columns";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const limited = publicEndpointRateLimit(req, "daily");
  if (limited) return limited;

  try {
    const result = await getLatestPublicDailyColumnRequestPayload(req);
    if (!result.ok) return publicError(result.error, result.status);

    // Daily column lands once per day; long stale-while-revalidate.
    return publicCachedJson(req, {
      endpoint: "daily",
      etagFamily: "public-daily",
      signal: result.payload.etagSignal,
      body: result.payload.body,
    });
  } catch (err) {
    return publicServerError("api/public/daily", err);
  }
}
