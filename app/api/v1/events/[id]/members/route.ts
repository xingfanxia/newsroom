/**
 * GET /api/v1/events/:id/members — Bearer-gated cross-source coverage list.
 *
 * Mirrors the public /api/events/:id/members shape but lives under the v1
 * namespace + Bearer-auth gate so agent integrations can use it through their
 * own API token without hitting the public endpoint's anonymous rate-limits.
 *
 * Path:    /api/v1/events/<cluster_id>/members
 * Query:   ?locale=zh|en   (default zh)
 *
 * Response:
 *   { members: [{ source_id, source_name, title, url, published_at, importance }],
 *     total: number }
 *
 * Returns 200 + empty members for unknown cluster ids so the calling agent
 * can degrade gracefully without a separate error path. Singleton clusters
 * (member_count = 1) just return their lone member.
 */
import { runV1Route, v1Error, v1Json } from "@/lib/api/v1-route";
import {
  parseEventMemberRouteParams,
  toEventMemberApiItems,
} from "@/lib/api/event-members";
import { getEventMembers } from "@/lib/items/live";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return runV1Route(req, async () => {
    const { id: idRaw } = await ctx.params;
    const url = new URL(req.url);
    const parsed = parseEventMemberRouteParams({
      rawId: idRaw,
      rawLocale: url.searchParams.get("locale"),
      defaultLocale: "zh",
    });
    if (!parsed.ok) {
      return v1Error(parsed.error, 400);
    }

    try {
      const members = await getEventMembers(parsed.clusterId, parsed.locale);
      return v1Json({
        members: toEventMemberApiItems(members),
        total: members.length,
      });
    } catch (err) {
      console.error("[api/v1/events/:id/members] failed", err);
      return v1Error("server_error", 500);
    }
  });
}
