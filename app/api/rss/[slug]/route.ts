import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { newsletters } from "@/db/schema";
import { renderRssFeed, type RssItem } from "@/lib/rss/render";
import { rssRateLimit } from "@/lib/rate-limit/rss";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SITE = "https://news.ax0x.ai";

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
    description: "今日 AI 行业要闻，自动聚合多源覆盖，论文已排除。",
    route: "/zh",
  },
  curated: {
    title: "AX Radar — AX 严选",
    description: "操作员手选信源，鸭哥/grapeot, AI 群聊日报, 阮一峰等。",
    route: "/zh/curated",
  },
  papers: {
    title: "AX Radar — 论文",
    description: "arXiv + HF Papers 等 AI 论文流。",
    route: "/zh/papers",
  },
};

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

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
      : await renderLaneFeed(slug as "today" | "curated" | "papers", meta);

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=900",
    },
  });
}

async function renderDailyFeed(
  meta: { title: string; description: string; route: string },
  slug: string,
): Promise<string> {
  const client = db();
  const rows = await client
    .select({
      id: newsletters.id,
      columnTitle: newsletters.columnTitle,
      columnSummaryMd: newsletters.columnSummaryMd,
      columnNarrativeMd: newsletters.columnNarrativeMd,
      columnThemeTag: newsletters.columnThemeTag,
      periodStart: newsletters.periodStart,
      publishedAt: newsletters.publishedAt,
    })
    .from(newsletters)
    .where(
      sql`${newsletters.kind} = 'daily'
        AND ${newsletters.locale} = 'zh'
        AND ${newsletters.columnTitle} IS NOT NULL`,
    )
    .orderBy(sql`${newsletters.periodStart} DESC`)
    .limit(50);

  const items: RssItem[] = rows.map((r) => {
    const dk = dateKey(r.periodStart);
    const link = `${SITE}/zh/daily/${dk}`;
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
    link: `${SITE}${meta.route}`,
    description: meta.description,
    lastBuildDate: items[0]?.pubDate ?? new Date(),
    items,
    selfLink: `${SITE}/api/rss/${slug}.xml`,
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
  slug: "today" | "curated" | "papers",
  meta: { title: string; description: string; route: string },
): Promise<string> {
  const client = db();

  const filterSql =
    slug === "curated"
      ? sql`s.curated = true AND NOT (s.tags && ARRAY['arxiv','paper']::text[])`
      : slug === "papers"
        ? sql`(s.tags && ARRAY['arxiv','paper']::text[])`
        : sql`NOT (s.tags && ARRAY['arxiv','paper']::text[])`;

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
    link: `${SITE}/zh/items/${r.id}`,
    description: r.summary_zh ?? r.summary_en ?? "",
    pubDate: r.published_at instanceof Date ? r.published_at : new Date(r.published_at),
    guid: r.url,
  }));

  return renderRssFeed({
    title: meta.title,
    link: `${SITE}${meta.route}`,
    description: meta.description,
    lastBuildDate: items[0]?.pubDate ?? new Date(),
    items,
    selfLink: `${SITE}/api/rss/${slug}.xml`,
  });
}
