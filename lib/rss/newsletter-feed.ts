import { desc, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { newsletters, type Newsletter } from "@/db/schema";
import {
  escapeXml,
  renderMarkdownishHtml,
  renderRssFeed,
  type RssItem,
} from "@/lib/rss/render";
import { publicUrl } from "@/lib/site";
import {
  appLocaleLanguageTag,
  MONTHLY_NEWSLETTER_KIND,
  type NewsletterLocale,
} from "@/lib/types";
export { parseNewsletterRssLocale } from "@/lib/rss/newsletter-feed-meta";

const NEWSLETTER_RSS_BRAND: Record<NewsletterLocale, string> = {
  en: "AX's AI RADAR — Daily + Monthly Brief",
  zh: "AX 的 AI 雷达 · 每日/每月 速递",
};

const NEWSLETTER_RSS_DESCRIPTION: Record<NewsletterLocale, string> = {
  en: "Editorial digest synthesized from the radar's featured stories — daily at 09:00 UTC, plus a monthly recap.",
  zh: "雷达精选的编辑摘要 — 每天 UTC 09:00 出品，附加每月综合。",
};

type StructuredNewsletterRssRow = Pick<
  Newsletter,
  | "id"
  | "kind"
  | "headline"
  | "overview"
  | "highlights"
  | "commentary"
  | "storyCount"
  | "periodStart"
  | "periodEnd"
  | "publishedAt"
>;

export async function renderStructuredNewsletterRssFeed(
  locale: NewsletterLocale,
): Promise<string> {
  const rows = await listStructuredNewsletterRows(locale);
  const items = rows.map((row) => structuredNewsletterRssItem(row, locale));

  return renderRssFeed({
    title: NEWSLETTER_RSS_BRAND[locale],
    link: publicUrl(`/${locale}`),
    description: NEWSLETTER_RSS_DESCRIPTION[locale],
    language: appLocaleLanguageTag(locale),
    lastBuildDate: items[0]?.pubDate ?? new Date(),
    selfLink: publicUrl(`/api/feed/newsletter/${locale}/rss.xml`),
    items,
  });
}

export function structuredNewsletterRssItem(
  row: StructuredNewsletterRssRow,
  locale: NewsletterLocale,
): RssItem {
  const kindLabel =
    row.kind === MONTHLY_NEWSLETTER_KIND
      ? locale === "zh"
        ? "月报"
        : "Monthly"
      : locale === "zh"
        ? "日报"
        : "Daily";
  // The DB query filters headline IS NOT NULL, but the column is nullable
  // because daily-column rows share the newsletters table.
  const headline = row.headline ?? "";
  const overview = row.overview ?? "";
  const highlights = row.highlights ?? "";
  const commentary = row.commentary ?? "";

  return {
    title: `[${kindLabel}] ${headline}`,
    link: publicUrl(`/${locale}/newsletter/${row.id}`),
    description: overview,
    pubDate: row.publishedAt,
    guid: `newsletter-${row.id}`,
    contentEncoded: structuredNewsletterContentHtml({
      headline,
      overview,
      highlights,
      commentary,
      storyCount: row.storyCount,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      locale,
    }),
    category: kindLabel,
  };
}

async function listStructuredNewsletterRows(
  locale: NewsletterLocale,
): Promise<StructuredNewsletterRssRow[]> {
  // Legacy structured-digest only — new daily column ships at /api/rss/daily.xml.
  // Filter out new daily-column rows (which have NULL headline + non-NULL column_title).
  return db()
    .select()
    .from(newsletters)
    .where(
      sql`${newsletters.locale} = ${locale}
        AND ${newsletters.headline} IS NOT NULL`,
    )
    .orderBy(desc(newsletters.publishedAt))
    .limit(60);
}

function structuredNewsletterContentHtml(args: {
  headline: string;
  overview: string;
  highlights: string;
  commentary: string;
  storyCount: number;
  periodStart: Date;
  periodEnd: Date;
  locale: NewsletterLocale;
}): string {
  const {
    headline,
    overview,
    highlights,
    commentary,
    storyCount,
    periodStart,
    periodEnd,
    locale,
  } = args;
  return `
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
<p><em>${locale === "zh" ? "覆盖" : "Covered"} ${storyCount} ${locale === "zh" ? "条故事" : "stories"} · ${formatNewsletterRange(periodStart, periodEnd, locale)}</em></p>`.trim();
}

function formatNewsletterRange(
  start: Date,
  end: Date,
  locale: NewsletterLocale,
): string {
  const fmt = new Intl.DateTimeFormat(appLocaleLanguageTag(locale), {
    month: "short",
    day: "numeric",
  });
  return `${fmt.format(start)} – ${fmt.format(new Date(end.getTime() - 1))}`;
}
