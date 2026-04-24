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
import { z } from "zod";
import { getEventMembers } from "@/lib/items/live";

const idSchema = z.coerce.number().int().positive();
const localeSchema = z.enum(["zh", "en"]).default("zh");

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: idRaw } = await ctx.params;
  const parsedId = idSchema.safeParse(idRaw);
  if (!parsedId.success) {
    return Response.json({ error: "invalid_id" }, { status: 400 });
  }

  const url = new URL(req.url);
  const parsedLocale = localeSchema.safeParse(url.searchParams.get("locale") ?? "zh");
  if (!parsedLocale.success) {
    return Response.json({ error: "invalid_locale" }, { status: 400 });
  }

  try {
    const members = await getEventMembers(parsedId.data, parsedLocale.data);
    return Response.json({
      members: members.map((m) => ({
        source_id: m.sourceId,
        source_name: m.sourceName,
        title: m.title,
        url: m.url,
        published_at: m.publishedAt,
        importance: m.importance,
      })),
      total: members.length,
    });
  } catch (err) {
    console.error("[api/events/:id/members] failed", err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
