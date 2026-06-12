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
  parseEventMemberRouteParams,
  toEventMemberApiItems,
} from "@/lib/api/event-members";
import { getEventMembers } from "@/lib/items/live";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: idRaw } = await ctx.params;
  const url = new URL(req.url);
  const parsed = parseEventMemberRouteParams({
    rawId: idRaw,
    rawLocale: url.searchParams.get("locale"),
    defaultLocale: "zh",
  });
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const members = await getEventMembers(parsed.clusterId, parsed.locale);
    return Response.json({
      members: toEventMemberApiItems(members),
      total: members.length,
    });
  } catch (err) {
    console.error("[api/events/:id/members] failed", err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
