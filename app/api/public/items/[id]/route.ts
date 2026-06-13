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
} from "@/lib/api/public-helpers";
import {
  getItemDetailRow,
  parseItemDetailRouteId,
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
  const parsed = parseItemDetailRouteId(idRaw);
  if (!parsed.ok) return publicError(parsed.error, 400);

  try {
    const row = await getItemDetailRow(parsed.id);
    if (!row) return publicError("not_found", 404);

    return publicCachedJson(req, {
      endpoint: "item",
      etagFamily: "public-item",
      signal: publicItemDetailEtagSignal(row),
      body: toPublicItemDetail(row),
    });
  } catch (err) {
    console.error("[api/public/items/:id] failed", err);
    return publicError("server_error", 500);
  }
}
