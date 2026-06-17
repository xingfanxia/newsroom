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
import {
  runV1Route,
  v1Error,
  v1Json,
} from "@/lib/api/v1-route";
import { getAgentItemDetailRoutePayload } from "@/lib/api/item-detail";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return runV1Route(req, async () => {
    const { id: idRaw } = await ctx.params;

    const found = await getAgentItemDetailRoutePayload(idRaw);
    if (!found.ok) {
      return v1Error(found.error, found.status);
    }
    return v1Json(found.payload);
  }, { serverErrorLabel: "api/v1/items/:id" });
}
