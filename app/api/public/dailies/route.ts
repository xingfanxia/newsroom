/**
 * GET /api/public/dailies — Daily column index (discovery).
 *
 * Returns recent daily-column rows in reverse chronological order. Useful for
 * an agent to enumerate "which dates have columns" without downloading every
 * body. Returns only the metadata (date / generated_at / title / theme_tag).
 *
 * take: 1..180, default 30. Strict 400 on out-of-range.
 */
import {
  publicCachedRoute,
} from "@/lib/api/public-helpers";
import { getPublicDailyColumnIndexRequestPayload } from "@/lib/api/daily-columns";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  return publicCachedRoute(req, {
    endpoint: "dailies",
    etagFamily: "public-dailies",
    label: "api/public/dailies",
    load: async () => {
      const result = await getPublicDailyColumnIndexRequestPayload(req);
      if (!result.ok) return result;

      return {
        ok: true,
        signal: result.payload.etagSignal,
        body: result.payload.body,
      };
    },
  });
}
