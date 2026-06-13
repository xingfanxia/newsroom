import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  dailyColumnDateKey,
  listDailyColumnRows,
  type DailyColumnRow,
} from "@/lib/api/daily-columns";
import { publicUrl } from "@/lib/site";
import { renderRssFeed, type RssItem } from "@/lib/rss/render";

const LEGACY_RSS_SLUGS = ["daily", "today", "curated"] as const;
type LegacyRssSlug = (typeof LEGACY_RSS_SLUGS)[number];
type LegacyLaneRssSlug = Exclude<LegacyRssSlug, "daily">;

type LegacyRssFeedMeta = {
  title: string;
  description: string;
  route: string;
};

const LEGACY_RSS_FEED_META: Record<LegacyRssSlug, LegacyRssFeedMeta> = {
  daily: {
    title: "AX Radar — 每日 AI 日报",
    description:
      "每日 9pm PT 一篇 AI 日报，2500-4500 字编辑视角，作者主笔。",
    route: "/zh/daily",
  },
  today: {
    title: "AX Radar — 热点聚合",
    description: "今日 AI 行业要闻，自动聚合多源覆盖。",
    route: "/zh",
  },
  curated: {
    title: "AX Radar — AX 严选",
    description: "操作员手选信源，鸭哥/grapeot, AI 群聊日报, 阮一峰等。",
    route: "/zh/curated",
  },
};

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
  published_at: Date | string;
  url: string;
};

export function parseLegacyRssSlug(rawSlug: string): LegacyRssSlug | null {
  const slug = rawSlug.replace(/\.xml$/, "");
  return (LEGACY_RSS_SLUGS as readonly string[]).includes(slug)
    ? (slug as LegacyRssSlug)
    : null;
}

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
  const link = publicUrl(`/zh/daily/${date}`);
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
    pubDate:
      row.published_at instanceof Date
        ? row.published_at
        : new Date(row.published_at),
    guid: row.url,
  };
}

async function legacyDailyRssItems(): Promise<RssItem[]> {
  const rows = await listDailyColumnRows({ locale: "zh", take: 50 });
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

  return (await db().execute(sql`
    SELECT i.id, i.title_zh, i.title_en, i.title, i.summary_zh, i.summary_en,
           i.published_at, i.url
    FROM items i
    JOIN sources s ON s.id = i.source_id
    WHERE i.published_at IS NOT NULL
      AND ${filterSql}
    ORDER BY i.published_at DESC NULLS LAST
    LIMIT 50
  `)) as unknown as LegacyLaneRssRow[];
}

function renderLegacyRssChannel(
  slug: LegacyRssSlug,
  items: RssItem[],
): string {
  const meta = LEGACY_RSS_FEED_META[slug];

  return renderRssFeed({
    title: meta.title,
    link: publicUrl(meta.route),
    description: meta.description,
    lastBuildDate: items[0]?.pubDate ?? new Date(),
    items,
    selfLink: publicUrl(`/api/rss/${slug}.xml`),
  });
}
