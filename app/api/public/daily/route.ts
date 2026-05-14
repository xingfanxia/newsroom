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

const localeSchema = z.enum(["zh", "en"]).default("zh");

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

type DailyRow = {
  id: number;
  locale: string;
  columnTitle: string | null;
  columnThemeTag: string | null;
  columnSummaryMd: string | null;
  columnNarrativeMd: string | null;
  columnFeaturedItemIds: number[] | null;
  itemIds: number[] | null;
  storyCount: number;
  periodStart: Date;
  periodEnd: Date;
  publishedAt: Date;
};

function toPublicDaily(row: DailyRow) {
  return {
    id: row.id,
    locale: row.locale,
    date: dateKey(row.periodStart),
    generated_at: row.publishedAt.toISOString(),
    window_start: row.periodStart.toISOString(),
    window_end: row.periodEnd.toISOString(),
    title: row.columnTitle,
    theme_tag: row.columnThemeTag,
    summary_md: row.columnSummaryMd,
    narrative_md: row.columnNarrativeMd,
    featured_item_ids: row.columnFeaturedItemIds ?? [],
    item_ids: row.itemIds ?? [],
    story_count: row.storyCount,
  };
}

export async function GET(req: Request) {
  const limited = publicRateLimit(req, {
    family: "public-daily",
    windowMs: 60_000,
    max: 300,
  });
  if (limited) return limited;

  const url = new URL(req.url);
  const parsedLocale = localeSchema.safeParse(
    url.searchParams.get("locale") ?? "zh",
  );
  if (!parsedLocale.success) return publicError("invalid_locale", 400);
  const locale = parsedLocale.data;

  try {
    const client = db();
    const rows = (await client
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
          AND ${newsletters.locale} = ${locale}
          AND ${newsletters.columnTitle} IS NOT NULL`,
      )
      .orderBy(sql`${newsletters.periodStart} DESC`)
      .limit(1)) as DailyRow[];

    if (rows.length === 0) {
      return publicError("no_daily_yet", 404);
    }

    const body = toPublicDaily(rows[0]);
    const etag = computeEtag(
      "public-daily",
      etagSignal({ id: rows[0].id, generated: body.generated_at }),
    );
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
