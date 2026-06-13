import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { newsletters } from "@/db/schema";
import {
  escapeXml,
  renderMarkdownishHtml,
  renderRssFeed,
  type RssItem,
} from "@/lib/rss/render";
import { sql, desc } from "drizzle-orm";

/** Cache for 10 min — daily newsletter lands once a day; cheap to refresh. */
export const revalidate = 600;

const SITE_URL = "https://newsroom-orpin.vercel.app";
const BRAND = {
  en: "AX's AI RADAR — Daily + Monthly Brief",
  zh: "AX 的 AI 雷达 · 每日/每月 速递",
};
const DESCRIPTION = {
  en: "Editorial digest synthesized from the radar's featured stories — daily at 09:00 UTC, plus a monthly recap.",
  zh: "雷达精选的编辑摘要 — 每天 UTC 09:00 出品，附加每月综合。",
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ locale: string }> },
) {
  const { locale: raw } = await params;
  const locale: "zh" | "en" = raw === "en" ? "en" : "zh";
  const client = db();

  // Legacy structured-digest only — new daily column ships at /api/rss/daily.xml.
  // Filter out new daily-column rows (which have NULL headline + non-NULL column_title).
  const rows = await client
    .select()
    .from(newsletters)
    .where(
      sql`${newsletters.locale} = ${locale}
        AND ${newsletters.headline} IS NOT NULL`,
    )
    .orderBy(desc(newsletters.publishedAt))
    .limit(60);

  const items: RssItem[] = rows.map((n) => {
    const path = `/${locale}/newsletter/${n.id}`;
    const kindLabel =
      n.kind === "monthly"
        ? locale === "zh"
          ? "月报"
          : "Monthly"
        : locale === "zh"
          ? "日报"
          : "Daily";
    // headline filter on the WHERE means these are non-null in practice,
    // but TS sees the column type as nullable post-migration.
    const headline = n.headline ?? "";
    const overview = n.overview ?? "";
    const highlights = n.highlights ?? "";
    const commentary = n.commentary ?? "";
    const title = `[${kindLabel}] ${headline}`;
    const content = `
<h2>${escapeXml(headline)}</h2>
<p><strong>${locale === "zh" ? "全局概览" : "Overview"}</strong></p>
<p>${escapeXml(overview)}</p>
<hr/>
<p><strong>${locale === "zh" ? "特别关注" : "Highlights"}</strong></p>
${renderMarkdownishHtml(highlights)}
<hr/>
<p><strong>${locale === "zh" ? "点评" : "Commentary"}</strong></p>
${renderMarkdownishHtml(commentary)}
<hr/>
<p><em>${locale === "zh" ? "覆盖" : "Covered"} ${n.storyCount} ${locale === "zh" ? "条故事" : "stories"} · ${formatRange(n.periodStart, n.periodEnd, locale)}</em></p>`.trim();

    return {
      title,
      link: SITE_URL + path,
      description: overview,
      pubDate: n.publishedAt,
      guid: `newsletter-${n.id}`,
      contentEncoded: content,
      category: kindLabel,
    };
  });

  const xml = renderRssFeed({
    title: BRAND[locale],
    link: `${SITE_URL}/${locale}`,
    description: DESCRIPTION[locale],
    language: locale === "zh" ? "zh-CN" : "en-US",
    lastBuildDate: items[0]?.pubDate ?? new Date(),
    selfLink: `${SITE_URL}/api/feed/newsletter/${locale}/rss.xml`,
    items,
  });

  return new NextResponse(xml, {
    status: 200,
    headers: {
      "content-type": "application/rss+xml; charset=utf-8",
      "cache-control":
        "public, max-age=600, s-maxage=600, stale-while-revalidate=3600",
    },
  });
}

function formatRange(start: Date, end: Date, locale: "zh" | "en"): string {
  const fmt = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
  });
  return `${fmt.format(start)} – ${fmt.format(new Date(end.getTime() - 1))}`;
}
