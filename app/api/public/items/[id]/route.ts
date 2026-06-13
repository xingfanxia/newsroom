/**
 * GET /api/public/items/:id — Anonymous full-item detail.
 *
 * Mirrors /api/v1/items/:id but strips LLM internals:
 *   - omits raw `reasoning` / `reasoningZh` / `reasoningEn`
 *   - keeps editor_note + editor_analysis (those ARE the public take)
 *   - HKR booleans only (no per-axis reasonsZh/reasonsEn)
 *   - body_md kept (transcript / article text); body_rss (raw HTML) dropped
 */
import { publicRateLimit } from "@/lib/rate-limit/public";
import {
  publicCacheConfig,
  publicRateLimitConfig,
} from "@/lib/api/public-endpoint-config";
import {
  computeEtag,
  ifNoneMatch,
  notModified,
  publicError,
  publicJson,
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
  const limited = publicRateLimit(req, publicRateLimitConfig("item"));
  if (limited) return limited;

  const { id: idRaw } = await ctx.params;
  const parsed = parseItemDetailRouteId(idRaw);
  if (!parsed.ok) return publicError(parsed.error, 400);

  try {
    const row = await getItemDetailRow(parsed.id);
    if (!row) return publicError("not_found", 404);

    const etag = computeEtag(
      "public-item",
      publicItemDetailEtagSignal(row),
    );
    if (ifNoneMatch(req, etag)) return notModified(etag);

    return publicJson(toPublicItemDetail(row), etag, publicCacheConfig("item"));
  } catch (err) {
    console.error("[api/public/items/:id] failed", err);
    return publicError("server_error", 500);
  }
}
