/**
 * GET /api/public/daily — Latest daily AI column (卡兹克-voice).
 *
 * Latest row from `newsletters` where kind='daily' AND column_title IS NOT NULL.
 * Cron writes one per day at ~9pm PT. Returns the column body: title +
 * theme tag + numbered exec summary (1-5 items, each w/ [#item-id] backlinks)
 * + 2000-4000 字 long-form narrative.
 *
 * locale=zh default. The daily-column worker currently writes zh rows.
 */
import { publicCachedRoute } from "@/lib/api/public-helpers";
import {
  latestDailySnapshotResult,
  readPublicSnapshot,
} from "@/lib/public-content/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  return publicCachedRoute(req, {
    endpoint: "daily",
    etagFamily: "public-daily",
    label: "api/public/daily",
    load: async () =>
      latestDailySnapshotResult(await readPublicSnapshot(), req),
  });
}
