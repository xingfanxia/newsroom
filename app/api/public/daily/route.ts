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
import { publicRateLimit } from "@/lib/rate-limit/public";
import {
  computeEtag,
  ifNoneMatch,
  notModified,
  publicError,
  publicJson,
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
  const limited = publicRateLimit(req, {
    family: "public-daily",
    windowMs: 60_000,
    max: 300,
  });
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
    const etag = computeEtag("public-daily", publicDailyColumnEtagSignal(row));
    if (ifNoneMatch(req, etag)) return notModified(etag);

    // Daily column lands once per day; long stale-while-revalidate.
    return publicJson(body, etag, {
      sMaxAge: 300,
      staleWhileRevalidate: 86_400,
    });
  } catch (err) {
    console.error("[api/public/daily] failed", err);
    return publicError("server_error", 500);
  }
}
