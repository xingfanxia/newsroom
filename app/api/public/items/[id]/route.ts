/**
 * GET /api/public/items/:id — Anonymous full-item detail.
 *
 * Mirrors /api/v1/items/:id but strips LLM internals:
 *   - omits raw `reasoning` / `reasoningZh` / `reasoningEn`
 *   - keeps editor_note + editor_analysis (those ARE the public take)
 *   - HKR booleans only (no per-axis reasonsZh/reasonsEn)
 *   - body_md kept (transcript / article text); body_rss (raw HTML) dropped
 */
import {
  publicCachedJson,
  publicEndpointRateLimit,
  publicError,
  publicServerError,
} from "@/lib/api/public-helpers";
import {
  getItemDetailRouteRow,
  publicItemDetailEtagSignal,
  toPublicItemDetail,
} from "@/lib/api/item-detail";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const limited = publicEndpointRateLimit(req, "item");
  if (limited) return limited;

  const { id: idRaw } = await ctx.params;

  try {
    const found = await getItemDetailRouteRow(idRaw);
    if (!found.ok) return publicError(found.error, found.status);

    return publicCachedJson(req, {
      endpoint: "item",
      etagFamily: "public-item",
      signal: publicItemDetailEtagSignal(found.row),
      body: toPublicItemDetail(found.row),
    });
  } catch (err) {
    return publicServerError("api/public/items/:id", err);
  }
}
