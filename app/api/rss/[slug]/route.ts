import { rssResponse } from "@/lib/rss/render";
import { rssRateLimit } from "@/lib/rate-limit/rss";
import {
  parseLegacyRssSlug,
  renderLegacyRssFeed,
} from "@/lib/rss/legacy-feeds";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const limited = rssRateLimit(req);
  if (limited) return limited;

  const { slug: rawSlug } = await params;
  const slug = parseLegacyRssSlug(rawSlug);
  if (!slug) {
    return new Response("not found", { status: 404 });
  }

  const xml = await renderLegacyRssFeed(slug);

  return rssResponse(xml);
}
