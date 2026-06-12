/**
 * GET /api/v1/sources — Bearer-gated source catalog with live health.
 *
 * Returns every row in `sources` joined with `source_health`, so agents
 * can check coverage before firing a query ("is there anything from
 * Dwarkesh in the last 48h?"). Disabled sources are included with
 * enabled=false — the operator may want to see what's in the catalog
 * even if the adapter is paused.
 */
import { requireApiToken } from "@/lib/auth/api-token";
import {
  listSourceCatalogRows,
  toV1SourceApiItem,
} from "@/lib/api/source-catalog";

export async function GET(req: Request) {
  const auth = await requireApiToken(req);
  if (auth instanceof Response) return auth;

  try {
    const rows = await listSourceCatalogRows("priority");
    return Response.json({
      sources: rows.map(toV1SourceApiItem),
      total: rows.length,
    });
  } catch (err) {
    console.error("[api/v1/sources] failed", err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
