import { getFeaturedStories } from "@/lib/items/live";
import {
  mainRssFeedMeta,
  type MainRssLocale,
} from "@/lib/rss/main-feed-meta";
import {
  escapeXml,
  renderMarkdownishHtml,
  renderRssFeed,
  type RssItem,
} from "@/lib/rss/render";
import { PUBLIC_SITE_HOST, publicUrl } from "@/lib/site";
import type { Story } from "@/lib/types";

export async function renderMainRssFeed(
  locale: MainRssLocale,
): Promise<string> {
  const meta = mainRssFeedMeta(locale);
  const stories = await listMainRssStories(locale);
  const items = stories.map(mainRssItem);

  return renderRssFeed({
    title: meta.channelTitle,
    link: publicUrl(meta.route),
    description: meta.channelDescription,
    language: meta.language,
    lastBuildDate: items[0]?.pubDate ?? new Date(),
    selfLink: publicUrl(meta.apiPath),
    generator: `${meta.channelTitle} (${PUBLIC_SITE_HOST})`,
    namespaces: {
      radar: publicUrl("/schemas/radar/1.0"),
    },
    items,
  });
}

async function listMainRssStories(locale: MainRssLocale): Promise<Story[]> {
  // Featured + p1 union, dedupped; fall back to `all` on slow days.
  const featured = await getFeaturedStories({
    tier: "featured",
    locale,
    limit: 50,
  });
  if (featured.length > 0) return featured;

  return getFeaturedStories({ tier: "all", locale, limit: 50 });
}

export function mainRssItem(story: Story): RssItem {
  return {
    title: story.title,
    link: story.url,
    description: story.summary,
    pubDate: new Date(story.publishedAt),
    guid: story.url,
    guidIsPermalink: true,
    source: story.source.publisher,
    category: story.tags.length ? story.tags.join(", ") : undefined,
    contentEncoded: buildMainRssContentHtml(story),
    extraElements: [
      { name: "importance", value: story.importance },
      { name: "tier", value: story.tier },
      { name: "crossSourceCount", value: story.crossSourceCount },
    ],
  };
}

export function buildMainRssContentHtml(story: {
  summary: string;
  editorNote?: string;
  editorAnalysis?: string;
}): string {
  const note = story.editorNote
    ? `<blockquote><strong>Editor&rsquo;s take:</strong> ${escapeXml(story.editorNote)}</blockquote>`
    : "";
  const summary = `<p>${escapeXml(story.summary)}</p>`;
  const analysis = story.editorAnalysis
    ? `<hr/>${renderMarkdownishHtml(story.editorAnalysis)}`
    : "";
  return `${note}${summary}${analysis}`;
}
