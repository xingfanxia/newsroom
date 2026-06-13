/**
 * GET /api/public/sources — Anonymous source catalog with live health.
 *
 * Mirrors /api/v1/sources but drops `last_error` (internal diagnostic) and
 * `last_fetched_at` (operational; not interesting publicly). Useful for
 * "does AX Radar cover X publisher?" before issuing a filtered feed query.
 */
import { publicRateLimit } from "@/lib/rate-limit/public";
import { publicRateLimitConfig } from "@/lib/rate-limit/public-config";
import {
  computeEtag,
  etagSignal,
  ifNoneMatch,
  notModified,
  publicError,
  publicJson,
} from "@/lib/api/public-helpers";
import {
  listSourceCatalogRows,
  toPublicSourceApiItem,
} from "@/lib/api/source-catalog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const limited = publicRateLimit(req, publicRateLimitConfig("sources"));
  if (limited) return limited;

  try {
    const rows = await listSourceCatalogRows("priority");
    const body = {
      sources: rows.map(toPublicSourceApiItem),
      total: rows.length,
    };

    const etag = computeEtag(
      "public-sources",
      etagSignal({
        count: rows.length,
        latest_success: rows
          .map((r) => r.lastSuccessAt?.toISOString() ?? "")
          .sort()
          .pop() ?? "",
      }),
    );
    if (ifNoneMatch(req, etag)) return notModified(etag);

    // Catalog rarely changes — long stale-while-revalidate.
    return publicJson(body, etag, {
      sMaxAge: 300,
      staleWhileRevalidate: 3600,
    });
  } catch (err) {
    console.error("[api/public/sources] failed", err);
    return publicError("server_error", 500);
  }
}
