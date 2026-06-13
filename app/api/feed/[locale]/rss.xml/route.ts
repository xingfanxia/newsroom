import { getFeaturedStories } from "@/lib/items/live";
import {
  escapeXml,
  renderMarkdownishHtml,
  renderRssFeed,
  rssResponse,
  type RssItem,
} from "@/lib/rss/render";
import { PUBLIC_SITE_HOST, publicUrl } from "@/lib/site";
import type { Story } from "@/lib/types";

/** Cache for 10 min — the underlying feed updates every 15 min via enrich cron. */
export const revalidate = 600;

const BRAND = { en: "AX's AI RADAR", zh: "AX 的 AI 雷达" };
const DESCRIPTION = {
  en: "Bilingual AI intelligence radar — curated daily signal from the monitored source catalog.",
  zh: "双语 AI 情报雷达 — 从已监控的精选信源目录中提炼每日高价值内容。",
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

  const items = stories.map((story): RssItem => {
    const extraElements = [
      { name: "importance", value: story.importance },
      { name: "tier", value: story.tier },
      { name: "crossSourceCount", value: story.crossSourceCount },
    ];

    return {
      title: story.title,
      link: story.url,
      description: story.summary,
      pubDate: new Date(story.publishedAt),
      guid: story.url,
      guidIsPermalink: true,
      source: story.source.publisher,
      category: story.tags.length ? story.tags.join(", ") : undefined,
      contentEncoded: buildContentHtml(story),
      extraElements,
    };
  });

  const xml = renderRssFeed({
    title: BRAND[locale],
    link: publicUrl(`/${locale}`),
    description: DESCRIPTION[locale],
    language: locale === "zh" ? "zh-CN" : "en-US",
    lastBuildDate: items[0]?.pubDate ?? new Date(),
    selfLink: publicUrl(`/api/feed/${locale}/rss.xml`),
    generator: `${BRAND[locale]} (${PUBLIC_SITE_HOST})`,
    namespaces: {
      radar: publicUrl("/schemas/radar/1.0"),
    },
    items,
  });

  return rssResponse(xml);
}

function buildContentHtml(s: {
  summary: string;
  editorNote?: string;
  editorAnalysis?: string;
}): string {
  const note = s.editorNote
    ? `<blockquote><strong>Editor&rsquo;s take:</strong> ${escapeXml(s.editorNote)}</blockquote>`
    : "";
  const summary = `<p>${escapeXml(s.summary)}</p>`;
  const analysis = s.editorAnalysis
    ? `<hr/>${renderMarkdownishHtml(s.editorAnalysis)}`
    : "";
  return `${note}${summary}${analysis}`;
}
