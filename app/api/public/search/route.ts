/**
 * GET /api/public/search — Anonymous snapshot-backed lexical search.
 *
 * `mode=lexical` (default) — LIKE substring against titles + bounded summary
 * excerpts from the compact R2 index, then item-shard hydration for hits.
 * `mode=semantic` — returns a documented 422. Semantic search remains on the
 * bearer-authenticated v1/MCP surfaces and never falls back to Turso here.
 *
 * Same item shape and field stripping as /api/public/feed.
 */
import { publicCachedRoute } from "@/lib/api/public-helpers";
import { publicSearchSnapshotRequestResult } from "@/lib/public-content/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  return publicCachedRoute(req, {
    endpoint: "search",
    etagFamily: "public-search",
    label: "api/public/search",
    load: async () => publicSearchSnapshotRequestResult(req),
  });
}
