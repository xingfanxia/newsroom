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
import {
  dailyColumnLocaleSchema,
  getLatestDailyColumnRow,
  publicDailyColumnEtagSignal,
  toPublicDailyColumn,
} from "@/lib/api/daily-columns";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const limited = publicEndpointRateLimit(req, "daily");
  if (limited) return limited;

  const url = new URL(req.url);
  const parsedLocale = dailyColumnLocaleSchema.safeParse(
    url.searchParams.get("locale") ?? "zh",
  );
  if (!parsedLocale.success) return publicError("invalid_locale", 400);
  const locale = parsedLocale.data;

  try {
    const row = await getLatestDailyColumnRow(locale);
    if (!row) {
      return publicError("no_daily_yet", 404);
    }

    const body = toPublicDailyColumn(row);
    // Daily column lands once per day; long stale-while-revalidate.
    return publicCachedJson(req, {
      endpoint: "daily",
      etagFamily: "public-daily",
      signal: publicDailyColumnEtagSignal(row),
      body,
    });
  } catch (err) {
    console.error("[api/public/daily] failed", err);
    return publicError("server_error", 500);
  }
}
