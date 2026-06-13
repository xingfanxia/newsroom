/**
 * GET /api/public/events/:id/members — Anonymous, rate-limited, ETag-aware.
 *
 * Same payload as /api/events/:id/members (the UI-internal endpoint) but
 * under /api/public/* with rate limit + CORS + ETag so it composes cleanly
 * with the documented public surface.
 *
 * Unknown cluster_id returns 200 with empty members[] so consumer agents can
 * degrade without a special error path — same convention as v1.
 */
import {
  parseEventMemberRouteParams,
  toEventMemberApiItems,
} from "@/lib/api/event-members";
import { getEventMembers } from "@/lib/items/live";
import { publicRateLimit } from "@/lib/rate-limit/public";
import {
  publicCacheConfig,
  publicRateLimitConfig,
} from "@/lib/api/public-endpoint-config";
import {
  computeEtag,
  etagSignal,
  ifNoneMatch,
  notModified,
  publicError,
  publicJson,
} from "@/lib/api/public-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const limited = publicRateLimit(req, publicRateLimitConfig("eventMembers"));
  if (limited) return limited;

  const { id: idRaw } = await ctx.params;
  const url = new URL(req.url);
  const parsed = parseEventMemberRouteParams({
    rawId: idRaw,
    rawLocale: url.searchParams.get("locale"),
    defaultLocale: "en",
  });
  if (!parsed.ok) return publicError(parsed.error, 400);

  try {
    const members = await getEventMembers(parsed.clusterId, parsed.locale);
    const body = {
      cluster_id: parsed.clusterId,
      members: toEventMemberApiItems(members),
      total: members.length,
    };
    const etag = computeEtag(
      "public-event",
      etagSignal({
        cluster_id: parsed.clusterId,
        n: members.length,
        last_at: members[members.length - 1]?.publishedAt ?? "",
      }),
    );
    if (ifNoneMatch(req, etag)) return notModified(etag);
    return publicJson(body, etag, publicCacheConfig("eventMembers"));
  } catch (err) {
    console.error("[api/public/events/:id/members] failed", err);
    return publicError("server_error", 500);
  }
}
