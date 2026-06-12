/**
 * GET /api/v1/items/:id — full-detail item lookup.
 *
 * The "give me everything you have on this item" endpoint: both-locale
 * title/summary, editor note, full markdown analysis, LLM reasoning, HKR
 * breakdown with per-axis reasons, full body_md transcript (for YT) or
 * article body. Intended for agents that spotted a hit in /feed and want
 * the deep context before commenting.
 *
 * If the item belongs to a multi-member event cluster, the response
 * includes an `event` block with the cluster-level canonical title,
 * cross-source commentary, importance, tier, and a members_url to fetch
 * the full coverage list. For singletons, `event` is null.
 *
 * Returns 404 on unknown id. No cluster dedup here — if the caller knows
 * the id they get exactly that row.
 */
import { requireApiToken } from "@/lib/auth/api-token";
import {
  getItemDetailRow,
  parseItemDetailRouteId,
  toV1ItemDetail,
} from "@/lib/api/item-detail";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiToken(req);
  if (auth instanceof Response) return auth;

  const { id: idRaw } = await ctx.params;
  const parsed = parseItemDetailRouteId(idRaw);
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const row = await getItemDetailRow(parsed.id);
    if (!row) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    return Response.json(toV1ItemDetail(row));
  } catch (err) {
    console.error("[api/v1/items/:id] failed", err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
