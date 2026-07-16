/**
 * GET /api/public/dailies — Daily column index (discovery).
 *
 * Returns recent daily-column rows in reverse chronological order. Useful for
 * an agent to enumerate "which dates have columns" without downloading every
 * body. Returns only the metadata (date / generated_at / title / theme_tag).
 *
 * Daily-column public query bounds live in
 * `lib/daily-column/query-defaults.ts`. Strict 400 on out-of-range.
 */
import { publicCachedRoute } from "@/lib/api/public-helpers";
import {
  dailyIndexSnapshotRequestResult,
} from "@/lib/public-content/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  return publicCachedRoute(req, {
    endpoint: "dailies",
    etagFamily: "public-dailies",
    label: "api/public/dailies",
    load: async () => dailyIndexSnapshotRequestResult(req),
  });
}
