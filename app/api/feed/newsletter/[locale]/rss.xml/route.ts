import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { newsletters } from "@/db/schema";
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

  const items = rows
    .map((n) => {
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
<h2>${escape(headline)}</h2>
<p><strong>${locale === "zh" ? "全局概览" : "Overview"}</strong></p>
<p>${escape(overview)}</p>
<hr/>
<p><strong>${locale === "zh" ? "特别关注" : "Highlights"}</strong></p>
${mdToHtml(highlights)}
<hr/>
<p><strong>${locale === "zh" ? "点评" : "Commentary"}</strong></p>
${mdToHtml(commentary)}
<hr/>
<p><em>${locale === "zh" ? "覆盖" : "Covered"} ${n.storyCount} ${locale === "zh" ? "条故事" : "stories"} · ${formatRange(n.periodStart, n.periodEnd, locale)}</em></p>`.trim();

      return `    <item>
      <title>${escape(title)}</title>
      <link>${escape(SITE_URL + path)}</link>
      <guid isPermaLink="false">newsletter-${n.id}</guid>
      <pubDate>${n.publishedAt.toUTCString()}</pubDate>
      <description><![CDATA[${overview}]]></description>
      <content:encoded><![CDATA[${content}]]></content:encoded>
      <category>${escape(kindLabel)}</category>
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:atom="http://www.w3.org/2005/Atom"
  xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${escape(BRAND[locale])}</title>
    <link>${escape(SITE_URL + "/" + locale)}</link>
    <atom:link href="${escape(SITE_URL + "/api/feed/newsletter/" + locale + "/rss.xml")}" rel="self" type="application/rss+xml"/>
    <description>${escape(DESCRIPTION[locale])}</description>
    <language>${locale === "zh" ? "zh-CN" : "en-US"}</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>`;

  return new NextResponse(xml, {
    status: 200,
    headers: {
      "content-type": "application/rss+xml; charset=utf-8",
      "cache-control":
        "public, max-age=600, s-maxage=600, stale-while-revalidate=3600",
    },
  });
}

function mdToHtml(md: string): string {
  const escaped = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .replace(/^## (.+)$/gm, "<h3>$1</h3>")
    .replace(/^# (.+)$/gm, "<h2>$1</h2>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`)
    .split(/\n\s*\n/)
    .map((b) =>
      /^<(h\d|ul|hr|blockquote)/.test(b.trimStart()) ? b : `<p>${b.trim()}</p>`,
    )
    .filter(Boolean)
    .join("\n");
}

function formatRange(start: Date, end: Date, locale: "zh" | "en"): string {
  const fmt = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
  });
  return `${fmt.format(start)} – ${fmt.format(new Date(end.getTime() - 1))}`;
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
