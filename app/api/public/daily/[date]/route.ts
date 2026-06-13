/**
 * GET /api/public/daily/{YYYY-MM-DD} — Daily AI column for a specific date.
 *
 * Returns the column written for the 24h window whose period_start falls on
 * the requested UTC date. 404 if no column for that date.
 */
import { publicRateLimit } from "@/lib/rate-limit/public";
import {
  publicCacheConfig,
  publicRateLimitConfig,
} from "@/lib/api/public-endpoint-config";
import {
  computeEtag,
  ifNoneMatch,
  notModified,
  publicError,
  publicJson,
} from "@/lib/api/public-helpers";
import {
  dailyColumnDateSchema,
  dailyColumnLocaleSchema,
  getDailyColumnRowByDate,
  publicDailyColumnEtagSignal,
  toPublicDailyColumn,
} from "@/lib/api/daily-columns";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ date: string }> },
) {
  const limited = publicRateLimit(req, publicRateLimitConfig("dailyByDate"));
  if (limited) return limited;

  const { date: rawDate } = await ctx.params;
  const parsedDate = dailyColumnDateSchema.safeParse(rawDate);
  if (!parsedDate.success) return publicError("invalid_date", 400);

  const url = new URL(req.url);
  const parsedLocale = dailyColumnLocaleSchema.safeParse(
    url.searchParams.get("locale") ?? "zh",
  );
  if (!parsedLocale.success) return publicError("invalid_locale", 400);

  try {
    const row = await getDailyColumnRowByDate(
      parsedDate.data,
      parsedLocale.data,
    );
    if (!row) {
      return publicError(`no_daily_for_${parsedDate.data}`, 404);
    }

    const body = toPublicDailyColumn(row);
    const etag = computeEtag(
      "public-daily-date",
      publicDailyColumnEtagSignal(row),
    );
    if (ifNoneMatch(req, etag)) return notModified(etag);

    // Historical dailies are immutable — aggressive cache.
    return publicJson(body, etag, publicCacheConfig("dailyByDate"));
  } catch (err) {
    console.error("[api/public/daily/:date] failed", err);
    return publicError("server_error", 500);
  }
}
