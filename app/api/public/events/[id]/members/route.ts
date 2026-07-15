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
import { DEFAULT_PUBLIC_EVENT_MEMBERS_LOCALE } from "@/lib/event-members/query-defaults";
import { publicCachedRoute } from "@/lib/api/public-helpers";
import {
  publicEventMembersSnapshotResult,
  readPublicSnapshot,
} from "@/lib/public-content/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return publicCachedRoute(req, {
    endpoint: "eventMembers",
    etagFamily: "public-event",
    label: "api/public/events/:id/members",
    load: async () => {
      const { id: idRaw } = await ctx.params;
      return publicEventMembersSnapshotResult(await readPublicSnapshot(), req, {
        rawId: idRaw,
        defaultLocale: DEFAULT_PUBLIC_EVENT_MEMBERS_LOCALE,
      });
    },
  });
}
