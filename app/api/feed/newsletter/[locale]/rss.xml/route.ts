import {
  rssResponse,
} from "@/lib/rss/render";
import {
  parseNewsletterRssLocale,
  renderStructuredNewsletterRssFeed,
} from "@/lib/rss/newsletter-feed";

/** Cache for 10 min — daily newsletter lands once a day; cheap to refresh. */
export const revalidate = 600;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ locale: string }> },
) {
  const { locale: raw } = await params;
  const locale = parseNewsletterRssLocale(raw);
  const xml = await renderStructuredNewsletterRssFeed(locale);

  return rssResponse(xml);
}
