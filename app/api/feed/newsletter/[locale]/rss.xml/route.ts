import { newsletterPublicRssResponse } from "@/lib/public-content/rss-http";
import { parseNewsletterRssLocale } from "@/lib/rss/newsletter-feed-meta";

/** Cache for 10 min — daily newsletter lands once a day; cheap to refresh. */
export const revalidate = 600;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ locale: string }> },
) {
  const { locale: raw } = await params;
  const locale = parseNewsletterRssLocale(raw);
  return newsletterPublicRssResponse(locale);
}
