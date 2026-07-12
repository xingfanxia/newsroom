import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  dailyColumnDateKey,
  listDailyColumnRows,
  type DailyColumnRow,
} from "@/lib/api/daily-columns";
import { dailyColumnIssueRoute } from "@/lib/daily-column/routes";
import {
  legacyRssFeedMeta,
  type LegacyLaneRssSlug,
  type LegacyRssSlug,
} from "@/lib/rss/legacy-feed-meta";
import { publicUrl } from "@/lib/site";
import { renderRssFeed, type RssItem } from "@/lib/rss/render";
import { DAILY_COLUMN_LOCALE } from "@/lib/types";

export { parseLegacyRssSlug } from "@/lib/rss/legacy-feed-meta";

type DailyColumnRssRow = Pick<
  DailyColumnRow,
  | "columnTitle"
  | "columnThemeTag"
  | "columnSummaryMd"
  | "columnNarrativeMd"
  | "periodStart"
  | "publishedAt"
>;

type LegacyLaneRssRow = {
  id: number;
  title_zh: string | null;
  title_en: string | null;
  title: string;
  summary_zh: string | null;
  summary_en: string | null;
  // Raw-SQL selected timestamp: libSQL returns the INTEGER ms-epoch as a number.
  published_at: number;
  url: string;
};

export async function renderLegacyRssFeed(
  slug: LegacyRssSlug,
): Promise<string> {
  const items =
    slug === "daily"
      ? await legacyDailyRssItems()
      : await legacyLaneRssItems(slug);

  return renderLegacyRssChannel(slug, items);
}

export function dailyColumnRssItem(row: DailyColumnRssRow): RssItem {
  const date = dailyColumnDateKey(row.periodStart);
  const link = publicUrl(dailyColumnIssueRoute(date));
  const issueId = `AX 的 AI 日报 · ${date}`;
  const subtitle = row.columnTitle ?? "";

  return {
    title: subtitle ? `${issueId} · ${subtitle}` : issueId,
    link,
    description: row.columnSummaryMd ?? "",
    pubDate: row.publishedAt,
    guid: link,
    category: row.columnThemeTag ?? undefined,
    contentEncoded: `${row.columnSummaryMd ?? ""}\n\n${row.columnNarrativeMd ?? ""}`,
  };
}

export function legacyLaneRssItem(row: LegacyLaneRssRow): RssItem {
  return {
    title: row.title_zh ?? row.title_en ?? row.title,
    link: publicUrl(`/zh/items/${row.id}`),
    description: row.summary_zh ?? row.summary_en ?? "",
    pubDate: new Date(row.published_at),
    guid: row.url,
  };
}

async function legacyDailyRssItems(): Promise<RssItem[]> {
  const rows = await listDailyColumnRows({ locale: DAILY_COLUMN_LOCALE, take: 50 });
  return rows.map(dailyColumnRssItem);
}

async function legacyLaneRssItems(slug: LegacyLaneRssSlug): Promise<RssItem[]> {
  const rows = await listLegacyLaneRows(slug);
  return rows.map(legacyLaneRssItem);
}

async function listLegacyLaneRows(
  slug: LegacyLaneRssSlug,
): Promise<LegacyLaneRssRow[]> {
  const filterSql =
    slug === "curated" ? sql`s.curated = true` : sql`TRUE`;

  return await db().all<LegacyLaneRssRow>(sql`
    SELECT i.id, i.title_zh, i.title_en, i.title, i.summary_zh, i.summary_en,
           i.published_at, i.url
    FROM items i
    JOIN sources s ON s.id = i.source_id
    WHERE i.published_at IS NOT NULL
      AND ${filterSql}
    ORDER BY i.published_at DESC NULLS LAST
    LIMIT 50
  `);
}

function renderLegacyRssChannel(
  slug: LegacyRssSlug,
  items: RssItem[],
): string {
  const meta = legacyRssFeedMeta(slug);

  return renderRssFeed({
    title: meta.channelTitle,
    link: publicUrl(meta.route),
    description: meta.channelDescription,
    lastBuildDate: items[0]?.pubDate ?? new Date(),
    items,
    selfLink: publicUrl(meta.apiPath),
  });
}
