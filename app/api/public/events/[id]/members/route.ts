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
  eventMembersCacheSignalParts,
  getEventMembersRequestPayload,
} from "@/lib/api/event-members";
import {
  etagSignal,
  publicCachedJson,
  publicEndpointRateLimit,
  publicError,
  publicServerError,
} from "@/lib/api/public-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const limited = publicEndpointRateLimit(req, "eventMembers");
  if (limited) return limited;

  const { id: idRaw } = await ctx.params;

  try {
    const result = await getEventMembersRequestPayload(req, {
      rawId: idRaw,
      defaultLocale: "en",
    });
    if (!result.ok) return publicError(result.error, result.status);

    const body = result.payload;
    return publicCachedJson(req, {
      endpoint: "eventMembers",
      etagFamily: "public-event",
      signal: etagSignal(eventMembersCacheSignalParts(body)),
      body,
    });
  } catch (err) {
    return publicServerError("api/public/events/:id/members", err);
  }
}
