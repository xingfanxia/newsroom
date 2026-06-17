/**
 * GET /api/v1/sources — Bearer-gated source catalog with live health.
 *
 * Returns every row in `sources` joined with `source_health`, so agents
 * can check coverage before firing a query ("is there anything from
 * Dwarkesh in the last 48h?"). Disabled sources are included with
 * enabled=false — the operator may want to see what's in the catalog
 * even if the adapter is paused.
 */
import {
  runV1Route,
  v1Json,
} from "@/lib/api/v1-route";
import {
  listSourceCatalogRows,
  toV1SourceApiItem,
} from "@/lib/api/source-catalog";

export async function GET(req: Request) {
  return runV1Route(req, async () => {
    const rows = await listSourceCatalogRows("priority");
    return v1Json({
      sources: rows.map(toV1SourceApiItem),
      total: rows.length,
    });
  }, { serverErrorLabel: "api/v1/sources" });
}
