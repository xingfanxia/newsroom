/**
 * GET /api/events/:id/members — signal drawer payload.
 *
 * Returns all items that belong to a cluster (event), ordered by importance DESC.
 * Used by the UI's signal drawer to surface cross-source coverage on multi-member
 * event cards. Public: cluster IDs are already observable via /api/v1/feed's
 * `cluster_id` field, and the payload fields are exactly what the feed already
 * exposes publicly for each item.
 *
 * Query: ?locale=zh|en
 * Locale default lives in `lib/event-members/query-defaults.ts`.
 *
 * Response shape:
 *   { members: [{ source_id, source_name, title, url, published_at, importance }] }
 *
 * Returns empty members array (not 404) for unknown cluster ids so the UI's
 * drawer can degrade gracefully without a separate error path.
 */
import { DEFAULT_UI_EVENT_MEMBERS_LOCALE } from "@/lib/event-members/query-defaults";
import {
  plainError,
  plainJson,
  runPlainRoute,
} from "@/lib/api/plain-response";
import { publicEventMembersSnapshotRequestResult } from "@/lib/public-content/http";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return runPlainRoute(async () => {
    const { id: idRaw } = await ctx.params;
    const result = await publicEventMembersSnapshotRequestResult(
      req,
      {
        rawId: idRaw,
        defaultLocale: DEFAULT_UI_EVENT_MEMBERS_LOCALE,
        listOnly: true,
      },
    );
    return result.ok
      ? plainJson(result.body)
      : plainError(result.error, result.status);
  }, { serverErrorLabel: "api/events/:id/members" });
}
