import { NextResponse } from "next/server";
import { getFeaturedStories } from "@/lib/items/live";
import type { Story } from "@/lib/types";

/** Cache for 10 min — the underlying feed updates every 15 min via enrich cron. */
export const revalidate = 600;

const SITE_URL = "https://newsroom-orpin.vercel.app";
const BRAND = { en: "AX's AI RADAR", zh: "AX 的 AI 雷达" };
const DESCRIPTION = {
  en: "Bilingual AI intelligence radar — curated daily signal from 50+ sources.",
  zh: "双语 AI 情报雷达 — 每日精选 50+ 来源的高价值内容。",
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ locale: string }> },
) {
  const { locale: raw } = await params;
  const locale: "zh" | "en" = raw === "en" ? "en" : "zh";

  // Featured + p1 union, dedupped; fall back to `all` on slow days
  let stories: Story[] = await getFeaturedStories({
    tier: "featured",
    locale,
    limit: 50,
  });
  if (stories.length === 0) {
    stories = await getFeaturedStories({ tier: "all", locale, limit: 50 });
  }

  const xml = buildRss({
    locale,
    siteUrl: SITE_URL,
    selfUrl: `${SITE_URL}/api/feed/${locale}/rss.xml`,
    title: BRAND[locale],
    description: DESCRIPTION[locale],
    stories,
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

function buildRss(args: {
  locale: "zh" | "en";
  siteUrl: string;
  selfUrl: string;
  title: string;
  description: string;
  stories: Story[];
}): string {
  const { locale, siteUrl, selfUrl, title, description, stories } = args;
  const now = new Date().toUTCString();
  const language = locale === "zh" ? "zh-CN" : "en-US";

  const items = stories
    .map((s) => {
      const tagsLine = s.tags.length
        ? `<category>${escape(s.tags.join(", "))}</category>`
        : "";
      const score = `<importance>${s.importance}</importance>`;
      const tier = `<tier>${s.tier}</tier>`;
      const cross =
        s.crossSourceCount != null
          ? `<crossSourceCount>${s.crossSourceCount}</crossSourceCount>`
          : "";
      // content:encoded — full body combining editor note + summary + analysis.
      // Most readers render this in the detail pane; fallback to <description>.
      const contentHtml = buildContentHtml(s);
      return `    <item>
      <title>${escape(s.title)}</title>
      <link>${escape(s.url)}</link>
      <guid isPermaLink="true">${escape(s.url)}</guid>
      <pubDate>${new Date(s.publishedAt).toUTCString()}</pubDate>
      <source>${escape(s.source.publisher)}</source>
      <description><![CDATA[${s.summary}]]></description>
      <content:encoded><![CDATA[${contentHtml}]]></content:encoded>
      ${tagsLine}
      ${score}
      ${tier}
      ${cross}
    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:atom="http://www.w3.org/2005/Atom"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:radar="${siteUrl}/schemas/radar/1.0">
  <channel>
    <title>${escape(title)}</title>
    <link>${escape(siteUrl)}/${locale}</link>
    <atom:link href="${escape(selfUrl)}" rel="self" type="application/rss+xml"/>
    <description>${escape(description)}</description>
    <language>${language}</language>
    <lastBuildDate>${now}</lastBuildDate>
    <generator>${escape(title)} (newsroom-orpin.vercel.app)</generator>
${items}
  </channel>
</rss>`;
}

/**
 * Minimal markdown-ish → HTML rendering for RSS content:encoded.
 * Preserves the headings and paragraph breaks produced by the commentary stage
 * without pulling in a full markdown library in a Fluid route.
 */
function mdToHtml(md: string): string {
  const escaped = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const withHeadings = escaped
    .replace(/^## (.+)$/gm, "<h3>$1</h3>")
    .replace(/^# (.+)$/gm, "<h2>$1</h2>");
  const paragraphs = withHeadings
    .split(/\n\s*\n/)
    .map((block) =>
      block.trimStart().startsWith("<h") ? block : `<p>${block.trim()}</p>`,
    )
    .filter(Boolean)
    .join("\n");
  return paragraphs;
}

function buildContentHtml(s: {
  summary: string;
  editorNote?: string;
  editorAnalysis?: string;
}): string {
  const note = s.editorNote
    ? `<blockquote><strong>Editor&rsquo;s take:</strong> ${s.editorNote}</blockquote>`
    : "";
  const summary = `<p>${s.summary}</p>`;
  const analysis = s.editorAnalysis ? `<hr/>${mdToHtml(s.editorAnalysis)}` : "";
  return `${note}${summary}${analysis}`;
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
