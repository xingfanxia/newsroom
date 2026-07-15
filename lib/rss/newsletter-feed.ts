import {
  escapeXml,
  renderMarkdownishHtml,
  type RssItem,
} from "@/lib/rss/render";
import { publicUrl } from "@/lib/site";
import {
  appLocaleLanguageTag,
  MONTHLY_NEWSLETTER_KIND,
  type NewsletterKind,
  type NewsletterLocale,
} from "@/lib/types";
export { parseNewsletterRssLocale } from "@/lib/rss/newsletter-feed-meta";

type StructuredNewsletterRssRow = {
  id: number;
  kind: NewsletterKind;
  headline: string | null;
  overview: string | null;
  highlights: string | null;
  commentary: string | null;
  storyCount: number;
  periodStart: Date;
  periodEnd: Date;
  publishedAt: Date;
};

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
  // Legacy structured-digest rows require a headline, but the shared table
  // type is nullable because daily-column rows use different fields.
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
