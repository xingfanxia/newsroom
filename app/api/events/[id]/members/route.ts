/**
 * GET /api/events/:id/members — signal drawer payload.
 *
 * Returns all items that belong to a cluster (event), ordered by importance DESC.
 * Used by the UI's signal drawer to surface cross-source coverage on multi-member
 * event cards. Public: cluster IDs are already observable via /api/v1/feed's
 * `cluster_id` field, and the payload fields are exactly what the feed already
 * exposes publicly for each item.
 *
 * Query: ?locale=zh|en  (default zh)
 *
 * Response shape:
 *   { members: [{ source_id, source_name, title, url, published_at, importance }] }
 *
 * Returns empty members array (not 404) for unknown cluster ids so the UI's
 * drawer can degrade gracefully without a separate error path.
 */
import {
  getEventMembersRequestPayload,
  toEventMembersListEnvelope,
} from "@/lib/api/event-members";
import {
  plainError,
  plainJson,
  plainServerError,
} from "@/lib/api/plain-response";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: idRaw } = await ctx.params;

  try {
    const result = await getEventMembersRequestPayload(req, {
      rawId: idRaw,
      defaultLocale: "zh",
    });
    if (!result.ok) {
      return plainError(result.error, result.status);
    }

    return plainJson(toEventMembersListEnvelope(result.payload));
  } catch (err) {
    return plainServerError("api/events/:id/members", err);
  }
}
