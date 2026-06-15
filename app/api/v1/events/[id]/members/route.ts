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
  v1Json,
  v1RouteResult,
  v1ServerError,
} from "@/lib/api/v1-route";
import {
  getEventMembersRequestPayload,
  toEventMembersListEnvelope,
} from "@/lib/api/event-members";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return runV1Route(req, async () => {
    const { id: idRaw } = await ctx.params;

    try {
      const result = await getEventMembersRequestPayload(req, {
        rawId: idRaw,
        defaultLocale: "zh",
      });
      return v1RouteResult(result, (payload) =>
        v1Json(toEventMembersListEnvelope(payload)),
      );
    } catch (err) {
      return v1ServerError("api/v1/events/:id/members", err);
    }
  });
}
