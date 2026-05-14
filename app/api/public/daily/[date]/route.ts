/**
 * GET /api/public/daily/{YYYY-MM-DD} — Daily AI column for a specific date.
 *
 * Returns the column written for the 24h window whose period_start falls on
 * the requested UTC date. 404 if no column for that date.
 */
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { newsletters } from "@/db/schema";
import { publicRateLimit } from "@/lib/rate-limit/public";
import {
  computeEtag,
  etagSignal,
  ifNoneMatch,
  notModified,
  publicError,
  publicJson,
} from "@/lib/api/public-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const localeSchema = z.enum(["zh", "en"]).default("zh");

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ date: string }> },
) {
  const limited = publicRateLimit(req, {
    family: "public-daily",
    windowMs: 60_000,
    max: 300,
  });
  if (limited) return limited;

  const { date: rawDate } = await ctx.params;
  const parsedDate = dateSchema.safeParse(rawDate);
  if (!parsedDate.success) return publicError("invalid_date", 400);

  const url = new URL(req.url);
  const parsedLocale = localeSchema.safeParse(
    url.searchParams.get("locale") ?? "zh",
  );
  if (!parsedLocale.success) return publicError("invalid_locale", 400);

  const dayStart = new Date(`${parsedDate.data}T00:00:00Z`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  try {
    const client = db();
    const rows = await client
      .select({
        id: newsletters.id,
        locale: newsletters.locale,
        columnTitle: newsletters.columnTitle,
        columnThemeTag: newsletters.columnThemeTag,
        columnSummaryMd: newsletters.columnSummaryMd,
        columnNarrativeMd: newsletters.columnNarrativeMd,
        columnFeaturedItemIds: newsletters.columnFeaturedItemIds,
        itemIds: newsletters.itemIds,
        storyCount: newsletters.storyCount,
        periodStart: newsletters.periodStart,
        periodEnd: newsletters.periodEnd,
        publishedAt: newsletters.publishedAt,
      })
      .from(newsletters)
      .where(
        sql`${newsletters.kind} = 'daily'
          AND ${newsletters.locale} = ${parsedLocale.data}
          AND ${newsletters.columnTitle} IS NOT NULL
          AND ${newsletters.periodStart} >= ${dayStart.toISOString()}::timestamptz
          AND ${newsletters.periodStart} <  ${dayEnd.toISOString()}::timestamptz`,
      )
      .limit(1);

    if (rows.length === 0) {
      return publicError(`no_daily_for_${parsedDate.data}`, 404);
    }
    const r = rows[0];
    const body = {
      id: r.id,
      locale: r.locale,
      date: dateKey(r.periodStart),
      generated_at: r.publishedAt.toISOString(),
      window_start: r.periodStart.toISOString(),
      window_end: r.periodEnd.toISOString(),
      title: r.columnTitle,
      theme_tag: r.columnThemeTag,
      summary_md: r.columnSummaryMd,
      narrative_md: r.columnNarrativeMd,
      featured_item_ids: r.columnFeaturedItemIds ?? [],
      item_ids: r.itemIds ?? [],
      story_count: r.storyCount,
    };
    const etag = computeEtag(
      "public-daily-date",
      etagSignal({ id: r.id, generated: body.generated_at }),
    );
    if (ifNoneMatch(req, etag)) return notModified(etag);

    // Historical dailies are immutable — aggressive cache.
    return publicJson(body, etag, {
      sMaxAge: 3600,
      staleWhileRevalidate: 86_400,
    });
  } catch (err) {
    console.error("[api/public/daily/:date] failed", err);
    return publicError("server_error", 500);
  }
}
