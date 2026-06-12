/**
 * GET /api/public/items/:id — Anonymous full-item detail.
 *
 * Mirrors /api/v1/items/:id but strips LLM internals:
 *   - omits raw `reasoning` / `reasoningZh` / `reasoningEn`
 *   - keeps editor_note + editor_analysis (those ARE the public take)
 *   - HKR booleans only (no per-axis reasonsZh/reasonsEn)
 *   - body_md kept (transcript / article text); body_rss (raw HTML) dropped
 */
import { z } from "zod";
import { publicRateLimit } from "@/lib/rate-limit/public";
import {
  computeEtag,
  ifNoneMatch,
  notModified,
  publicError,
  publicJson,
} from "@/lib/api/public-helpers";
import {
  getItemDetailRow,
  publicItemDetailEtagSignal,
  toPublicItemDetail,
} from "@/lib/api/item-detail";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const idSchema = z.coerce.number().int().positive();

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const limited = publicRateLimit(req, {
    family: "public-items",
    windowMs: 60_000,
    max: 600,
  });
  if (limited) return limited;

  const { id: idRaw } = await ctx.params;
  const parsed = idSchema.safeParse(idRaw);
  if (!parsed.success) return publicError("invalid_id", 400);
  const id = parsed.data;

  try {
    const row = await getItemDetailRow(id);
    if (!row) return publicError("not_found", 404);

    const etag = computeEtag(
      "public-item",
      publicItemDetailEtagSignal(row),
    );
    if (ifNoneMatch(req, etag)) return notModified(etag);

    return publicJson(toPublicItemDetail(row), etag, {
      sMaxAge: 120,
      staleWhileRevalidate: 600,
    });
  } catch (err) {
    console.error("[api/public/items/:id] failed", err);
    return publicError("server_error", 500);
  }
}
