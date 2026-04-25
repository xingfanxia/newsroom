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
import { z } from "zod";
import { requireApiToken } from "@/lib/auth/api-token";
import { getEventMembers } from "@/lib/items/live";

const idSchema = z.coerce.number().int().positive();
const localeSchema = z.enum(["zh", "en"]).default("zh");

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiToken(req);
  if (auth instanceof Response) return auth;

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
    console.error("[api/v1/events/:id/members] failed", err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
