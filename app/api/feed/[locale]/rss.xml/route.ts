import { mainPublicRssResponse } from "@/lib/public-content/rss-http";
import { coerceMainRssLocale } from "@/lib/rss/main-feed-meta";

/** Cache for 10 min — the underlying feed updates every 15 min via enrich cron. */
export const revalidate = 600;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ locale: string }> },
) {
  const { locale: raw } = await params;
  const locale = coerceMainRssLocale(raw);
  return mainPublicRssResponse(locale);
}
