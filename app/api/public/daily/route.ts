/**
 * GET /api/public/daily — Latest daily AI column (卡兹克-voice).
 *
 * Latest row from `newsletters` where kind='daily' AND column_title IS NOT NULL.
 * Cron writes one per day at ~9pm PT. Returns the column body: title +
 * theme tag + numbered exec summary (1-5 items, each w/ [#item-id] backlinks)
 * + 2000-4000 字 long-form narrative.
 *
 * locale=zh default. Only zh is generated today.
 */
import {
  publicCachedJson,
  publicEndpointRateLimit,
  publicError,
} from "@/lib/api/public-helpers";
import { getLatestPublicDailyColumn } from "@/lib/api/daily-columns";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const limited = publicEndpointRateLimit(req, "daily");
  if (limited) return limited;

  const url = new URL(req.url);

  try {
    const result = await getLatestPublicDailyColumn(
      url.searchParams.get("locale"),
    );
    if (!result.ok) return publicError(result.error, result.status);

    // Daily column lands once per day; long stale-while-revalidate.
    return publicCachedJson(req, {
      endpoint: "daily",
      etagFamily: "public-daily",
      signal: result.payload.etagSignal,
      body: result.payload.body,
    });
  } catch (err) {
    console.error("[api/public/daily] failed", err);
    return publicError("server_error", 500);
  }
}
