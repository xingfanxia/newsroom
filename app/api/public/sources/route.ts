/**
 * GET /api/public/sources — Anonymous source catalog with live health.
 *
 * Mirrors /api/v1/sources but drops `last_error` (internal diagnostic) and
 * `last_fetched_at` (operational; not interesting publicly). Useful for
 * "does AX Radar cover X publisher?" before issuing a filtered feed query.
 */
import {
  etagSignal,
  publicCachedJson,
  publicEndpointRateLimit,
  publicServerError,
} from "@/lib/api/public-helpers";
import {
  listSourceCatalogRows,
  toPublicSourceApiItem,
} from "@/lib/api/source-catalog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const limited = publicEndpointRateLimit(req, "sources");
  if (limited) return limited;

  try {
    const rows = await listSourceCatalogRows("priority");
    const body = {
      sources: rows.map(toPublicSourceApiItem),
      total: rows.length,
    };

    // Catalog rarely changes — long stale-while-revalidate.
    return publicCachedJson(req, {
      endpoint: "sources",
      etagFamily: "public-sources",
      signal: etagSignal({
        count: rows.length,
        latest_success: rows
          .map((r) => r.lastSuccessAt?.toISOString() ?? "")
          .sort()
          .pop() ?? "",
      }),
      body,
    });
  } catch (err) {
    return publicServerError("api/public/sources", err);
  }
}
