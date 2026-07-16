import { dailyColumnIssueRoute } from "@/lib/daily-column/routes";
import type { PublicDailyColumn } from "@/lib/public-content/public-dailies";
import { canonicalStateSchema } from "@/lib/public-content/contracts";
import { createPublicStateIndex } from "@/lib/public-content/public-items";
import { queryPublicFeed } from "@/lib/public-content/query";
import {
  legacyRssFeedMeta,
  type LegacyRssSlug,
} from "@/lib/rss/legacy-feed-meta";
import { mainRssFeedMeta } from "@/lib/rss/main-feed-meta";
import {
  RSS_CONTENT_TYPE,
  rssCacheControl,
} from "@/lib/rss/http-contract";
import {
  escapeXml,
  renderMarkdownishHtml,
  renderRssFeed,
  type RssItem,
} from "@/lib/rss/render";
import { PUBLIC_SITE_HOST, publicUrl } from "@/lib/site";
import {
  appLocaleLanguageTag,
  type AppLocale,
  type Story,
} from "@/lib/types";

const MAIN_RSS_RECENCY_FLOOR_DAYS = 14;

export type PublicRssArtifact = {
  xml: string;
  contentType: typeof RSS_CONTENT_TYPE;
  cacheControl: string;
};

export function renderMainPublicRss(
  value: unknown,
  locale: AppLocale,
  nowMs: number,
): PublicRssArtifact {
  const meta = mainRssFeedMeta(locale);
  let stories = queryPublicFeed(
    value,
    {
      tier: "featured",
      locale,
      limit: 50,
      recencyFloorDays: MAIN_RSS_RECENCY_FLOOR_DAYS,
    },
    { nowMs },
  ).items;
  if (stories.length === 0) {
    stories = queryPublicFeed(
      value,
      { tier: "all", locale, limit: 50 },
      { nowMs },
    ).items;
  }
  const items = stories.map(mainRssItem);
  return artifact(
    renderRssFeed({
      title: meta.channelTitle,
      link: publicUrl(meta.route),
      description: meta.channelDescription,
      language: meta.language,
      lastBuildDate: items[0]?.pubDate ?? new Date(nowMs),
      selfLink: publicUrl(meta.apiPath),
      generator: `${meta.channelTitle} (${PUBLIC_SITE_HOST})`,
      namespaces: { radar: publicUrl("/schemas/radar/1.0") },
      items,
    }),
  );
}

export function renderStructuredNewsletterPublicRss(
  value: unknown,
  locale: AppLocale,
  nowMs: number,
): PublicRssArtifact {
  const rows = canonicalStateSchema
    .parse(value)
    .newsletters.filter(
      (row): row is StructuredNewsletter =>
        row.format === "structured" && row.locale === locale,
    )
    .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))
    .slice(0, 60);
  const items = rows.map((row) => structuredNewsletterRssItem(row, locale));
  const title =
    locale === "en"
      ? "AX's AI RADAR — Daily + Monthly Brief"
      : "AX 的 AI 雷达 · 每日/每月 速递";
  const description =
    locale === "en"
      ? "Editorial digest synthesized from the radar's featured stories — daily at 09:00 UTC, plus a monthly recap."
      : "雷达精选的编辑摘要 — 每天 UTC 09:00 出品，附加每月综合。";
  return artifact(
    renderRssFeed({
      title,
      link: publicUrl(`/${locale}`),
      description,
      language: appLocaleLanguageTag(locale),
      lastBuildDate: items[0]?.pubDate ?? new Date(nowMs),
      selfLink: publicUrl(`/api/feed/newsletter/${locale}/rss.xml`),
      items,
    }),
  );
}

export function renderLegacyPublicRss(
  value: unknown,
  slug: LegacyRssSlug,
  nowMs: number,
): PublicRssArtifact {
  const items =
    slug === "daily"
      ? legacyDailyItems(value)
      : queryPublicFeed(
          value,
          {
            tier: "all",
            locale: "zh",
            curatedOnly: slug === "curated",
            limit: 50,
          },
          { nowMs },
        ).items.map(legacyLaneRssItem);
  const meta = legacyRssFeedMeta(slug);
  return artifact(
    renderRssFeed({
      title: meta.channelTitle,
      link: publicUrl(meta.route),
      description: meta.channelDescription,
      lastBuildDate: items[0]?.pubDate ?? new Date(nowMs),
      items,
      selfLink: publicUrl(meta.apiPath),
    }),
  );
}

function artifact(xml: string): PublicRssArtifact {
  return {
    xml,
    contentType: RSS_CONTENT_TYPE,
    cacheControl: rssCacheControl(),
  };
}

function mainRssItem(story: Story): RssItem {
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

function buildMainRssContentHtml(story: {
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

type StructuredNewsletter = Extract<
  ReturnType<typeof canonicalStateSchema.parse>["newsletters"][number],
  { format: "structured" }
>;

function structuredNewsletterRssItem(
  row: StructuredNewsletter,
  locale: AppLocale,
): RssItem {
  const kindLabel =
    row.kind === "monthly"
      ? locale === "zh"
        ? "月报"
        : "Monthly"
      : locale === "zh"
        ? "日报"
        : "Daily";
  const headline = row.headline ?? "";
  const overview = row.overview ?? "";
  const highlights = row.highlights ?? "";
  const commentary = row.commentary ?? "";
  return {
    title: `[${kindLabel}] ${headline}`,
    link: publicUrl(`/${locale}/newsletter/${row.id}`),
    description: overview,
    pubDate: new Date(row.publishedAt),
    guid: `newsletter-${row.id}`,
    contentEncoded: structuredNewsletterContentHtml({
      headline,
      overview,
      highlights,
      commentary,
      storyCount: row.storyCount,
      periodStart: new Date(row.periodStart),
      periodEnd: new Date(row.periodEnd),
      locale,
    }),
    category: kindLabel,
  };
}

function structuredNewsletterContentHtml(args: {
  headline: string;
  overview: string;
  highlights: string;
  commentary: string;
  storyCount: number;
  periodStart: Date;
  periodEnd: Date;
  locale: AppLocale;
}): string {
  const fmt = new Intl.DateTimeFormat(appLocaleLanguageTag(args.locale), {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const range = `${fmt.format(args.periodStart)} – ${fmt.format(new Date(args.periodEnd.getTime() - 1))}`;
  return `
<h2>${escapeXml(args.headline)}</h2>
<p><strong>${args.locale === "zh" ? "全局概览" : "Overview"}</strong></p>
<p>${escapeXml(args.overview)}</p>
<hr/>
<p><strong>${args.locale === "zh" ? "特别关注" : "Highlights"}</strong></p>
${renderMarkdownishHtml(args.highlights)}
<hr/>
<p><strong>${args.locale === "zh" ? "点评" : "Commentary"}</strong></p>
${renderMarkdownishHtml(args.commentary)}
<hr/>
<p><em>${args.locale === "zh" ? "覆盖" : "Covered"} ${args.storyCount} ${args.locale === "zh" ? "条故事" : "stories"} · ${range}</em></p>`.trim();
}

function legacyLaneRssItem(story: Story): RssItem {
  return {
    title: story.title,
    link: publicUrl(`/zh/items/${story.id}`),
    description: story.summary,
    pubDate: new Date(story.publishedAt),
    guid: story.url,
  };
}

function legacyDailyItems(value: unknown): RssItem[] {
  const state = createPublicStateIndex(value).state;
  return state.newsletters
    .filter(
      (row): row is DailyNewsletter =>
        row.format === "daily_column" && row.locale === "zh",
    )
    .sort((left, right) => right.periodStart.localeCompare(left.periodStart))
    .slice(0, 50)
    .map((row) =>
      dailyColumnRssItem({
        id: row.id,
        locale: row.locale,
        date: row.periodStart.slice(0, 10),
        generated_at: row.publishedAt,
        window_start: row.periodStart,
        window_end: row.periodEnd,
        title: row.title,
        theme_tag: row.themeTag,
        summary_md: row.summaryMd,
        narrative_md: row.narrativeMd,
        featured_item_ids: [...row.featuredItemIds],
        item_ids: [...row.itemIds],
        story_count: row.storyCount,
      }),
    );
}

type DailyNewsletter = Extract<
  ReturnType<typeof canonicalStateSchema.parse>["newsletters"][number],
  { format: "daily_column" }
>;

function dailyColumnRssItem(row: PublicDailyColumn): RssItem {
  const link = publicUrl(dailyColumnIssueRoute(row.date));
  const issueId = `AX 的 AI 日报 · ${row.date}`;
  const subtitle = row.title ?? "";
  return {
    title: subtitle ? `${issueId} · ${subtitle}` : issueId,
    link,
    description: row.summary_md ?? "",
    pubDate: new Date(row.generated_at),
    guid: link,
    category: row.theme_tag ?? undefined,
    contentEncoded: `${row.summary_md ?? ""}\n\n${row.narrative_md ?? ""}`,
  };
}
