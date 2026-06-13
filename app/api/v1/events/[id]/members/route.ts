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
import {
  runV1Route,
  v1Error,
  v1Json,
  v1ServerError,
} from "@/lib/api/v1-route";
import { getEventMembersRoutePayload } from "@/lib/api/event-members";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return runV1Route(req, async () => {
    const { id: idRaw } = await ctx.params;
    const url = new URL(req.url);

    try {
      const result = await getEventMembersRoutePayload({
        rawId: idRaw,
        rawLocale: url.searchParams.get("locale"),
        defaultLocale: "zh",
      });
      if (!result.ok) {
        return v1Error(result.error, result.status);
      }

      return v1Json({
        members: result.payload.members,
        total: result.payload.total,
      });
    } catch (err) {
      return v1ServerError("api/v1/events/:id/members", err);
    }
  });
}
