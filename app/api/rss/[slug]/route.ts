import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { renderRssFeed, rssResponse, type RssItem } from "@/lib/rss/render";
import { rssRateLimit } from "@/lib/rate-limit/rss";
import { publicUrl } from "@/lib/site";
import {
  dailyColumnDateKey,
  listDailyColumnRows,
} from "@/lib/api/daily-columns";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FEED_META: Record<
  string,
  { title: string; description: string; route: string }
> = {
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

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const limited = rssRateLimit(req);
  if (limited) return limited;

  const { slug: rawSlug } = await params;
  const slug = rawSlug.replace(/\.xml$/, "");
  const meta = FEED_META[slug];
  if (!meta) {
    return new Response("not found", { status: 404 });
  }

  const xml =
    slug === "daily"
      ? await renderDailyFeed(meta, slug)
      : await renderLaneFeed(slug as "today" | "curated", meta);

  return rssResponse(xml, { maxAge: 900 });
}

async function renderDailyFeed(
  meta: { title: string; description: string; route: string },
  slug: string,
): Promise<string> {
  const rows = await listDailyColumnRows({ locale: "zh", take: 50 });

  const items: RssItem[] = rows.map((r) => {
    const dk = dailyColumnDateKey(r.periodStart);
    const link = publicUrl(`/zh/daily/${dk}`);
    const issueId = `AX 的 AI 日报 · ${dk}`;
    const subtitle = r.columnTitle ?? "";
    return {
      title: subtitle ? `${issueId} · ${subtitle}` : issueId,
      link,
      description: r.columnSummaryMd ?? "",
      pubDate: r.publishedAt,
      guid: link,
      category: r.columnThemeTag ?? undefined,
      contentEncoded: `${r.columnSummaryMd ?? ""}\n\n${r.columnNarrativeMd ?? ""}`,
    };
  });

  return renderRssFeed({
    title: meta.title,
    link: publicUrl(meta.route),
    description: meta.description,
    lastBuildDate: items[0]?.pubDate ?? new Date(),
    items,
    selfLink: publicUrl(`/api/rss/${slug}.xml`),
  });
}

type LaneRow = {
  id: number;
  title_zh: string | null;
  title_en: string | null;
  title: string;
  summary_zh: string | null;
  summary_en: string | null;
  published_at: Date;
  url: string;
};

async function renderLaneFeed(
  slug: "today" | "curated",
  meta: { title: string; description: string; route: string },
): Promise<string> {
  const client = db();

  const filterSql =
    slug === "curated" ? sql`s.curated = true` : sql`TRUE`;

  const rows = (await client.execute(sql`
    SELECT i.id, i.title_zh, i.title_en, i.title, i.summary_zh, i.summary_en,
           i.published_at, i.url
    FROM items i
    JOIN sources s ON s.id = i.source_id
    WHERE i.published_at IS NOT NULL
      AND ${filterSql}
    ORDER BY i.published_at DESC NULLS LAST
    LIMIT 50
  `)) as unknown as LaneRow[];

  const items: RssItem[] = rows.map((r) => ({
    title: r.title_zh ?? r.title_en ?? r.title,
    link: publicUrl(`/zh/items/${r.id}`),
    description: r.summary_zh ?? r.summary_en ?? "",
    pubDate: r.published_at instanceof Date ? r.published_at : new Date(r.published_at),
    guid: r.url,
  }));

  return renderRssFeed({
    title: meta.title,
    link: publicUrl(meta.route),
    description: meta.description,
    lastBuildDate: items[0]?.pubDate ?? new Date(),
    items,
    selfLink: publicUrl(`/api/rss/${slug}.xml`),
  });
}
