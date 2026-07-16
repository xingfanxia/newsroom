/**
 * GET /api/public/items/:id — Anonymous full-item detail.
 *
 * Mirrors /api/v1/items/:id but strips LLM internals:
 *   - omits raw `reasoning` / `reasoningZh` / `reasoningEn`
 *   - keeps editor_note + editor_analysis (those ARE the public take)
 *   - HKR booleans only (no per-axis reasonsZh/reasonsEn)
 *   - body_md kept (transcript / article text); body_rss (raw HTML) dropped
 */
import { publicCachedRoute } from "@/lib/api/public-helpers";
import {
  publicItemSnapshotResult,
  readPublicSnapshot,
} from "@/lib/public-content/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return publicCachedRoute(req, {
    endpoint: "item",
    etagFamily: "public-item",
    label: "api/public/items/:id",
    load: async () => {
      const { id: idRaw } = await ctx.params;
      return await publicItemSnapshotResult(
        await readPublicSnapshot(),
        idRaw,
      );
    },
  });
}
