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

/**
 * Read-budget floor (W9c) for the syndication feed's PRIMARY query. Without it,
 * each RSS render pins items_feed_cover_idx and SCANS every enriched row (~21.7K
 * on prod) to take the freshest 50 — and the route revalidates every 10 min, so
 * a continuously-polled reader drives that scan ~288×/day/locale (~187M rows/mo
 * at full poll). A recency floor pins items_feed_recent_idx and SEEKs the window
 * instead. An RSS feed is recent-by-nature (readers show the newest items; none
 * paginate to all-time), so bounding it is non-breaking: 14 days holds 373
 * featured+p1 leads on prod — 7.5× the 50-item limit, so the rendered feed is
 * byte-identical at current volume. Kept tighter than the archive page's 30d
 * because the feed only ever emits its top 50, never browses history. Ignored
 * inside buildFeedWhere when an explicit date is set (none here). Applied ONLY
 * to the featured path — the slow-day fallback stays unbounded (see below).
 * Exported for the wiring test.
 */
export const MAIN_RSS_RECENCY_FLOOR_DAYS = 14;

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
  // Featured + p1 union, dedupped. The featured path carries the W9c recency
  // floor (it runs on ~every render, so its scan→seek is the whole read win).
  const featured = await getFeaturedStories({
    tier: "featured",
    locale,
    limit: 50,
    recencyFloorDays: MAIN_RSS_RECENCY_FLOOR_DAYS,
  });
  if (featured.length > 0) return featured;

  // Slow-day fallback — runs ONLY when featured is empty (near-never; prod has
  // hundreds of featured leads inside the floor window). Kept UNFLOORED on
  // purpose: it's the safety net for a genuine content drought, where the right
  // answer is "the last 50 items whenever they were", not an empty feed. Its
  // rare unbounded scan costs ~nothing in aggregate.
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
