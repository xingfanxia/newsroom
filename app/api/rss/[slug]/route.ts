import { rssResponse } from "@/lib/rss/render";
import { rssRateLimit } from "@/lib/rate-limit/rss";
import { parseLegacyRssSlug } from "@/lib/rss/legacy-feeds";
import { renderLegacyRssFeedCached } from "@/lib/rss/legacy-feeds-cache";

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

  const xml = await renderLegacyRssFeedCached(slug);

  return rssResponse(xml);
}
