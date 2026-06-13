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
  publicCachedJson,
  publicEndpointRateLimit,
  publicError,
} from "@/lib/api/public-helpers";
import { queryParamsRecord } from "@/lib/api/query-params";
import { getPublicDailyColumnIndex } from "@/lib/api/daily-columns";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const limited = publicEndpointRateLimit(req, "dailies");
  if (limited) return limited;

  try {
    const result = await getPublicDailyColumnIndex(queryParamsRecord(req));
    if (!result.ok) return publicError(result.error, result.status);

    return publicCachedJson(req, {
      endpoint: "dailies",
      etagFamily: "public-dailies",
      signal: result.payload.etagSignal,
      body: result.payload.body,
    });
  } catch (err) {
    console.error("[api/public/dailies] failed", err);
    return publicError("server_error", 500);
  }
}
