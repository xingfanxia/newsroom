/**
 * GET /api/public/sources — Anonymous source catalog with live health.
 *
 * Mirrors /api/v1/sources but drops `last_error` (internal diagnostic) and
 * `last_fetched_at` (operational; not interesting publicly). Useful for
 * "does AX Radar cover X publisher?" before issuing a filtered feed query.
 */
import { publicCachedRoute } from "@/lib/api/public-helpers";
import {
  publicSourcesSnapshotResult,
  readPublicSnapshot,
} from "@/lib/public-content/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  return publicCachedRoute(req, {
    endpoint: "sources",
    etagFamily: "public-sources",
    label: "api/public/sources",
    load: async () => publicSourcesSnapshotResult(await readPublicSnapshot()),
  });
}
