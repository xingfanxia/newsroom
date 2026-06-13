/**
 * GET /api/v1/usage/summary — LLM spend + token mix + task breakdown.
 *
 * Wraps the existing /admin/usage data in an agent-readable flat shape
 * so a careful agent can check "do we have budget before I fire a batch?"
 * before spending real money.
 *
 * Fields are all lifetime-to-date counters scoped to the specified window.
 * Window = today | week | month | all (default week).
 */
import {
  runV1Route,
  v1InvalidQuery,
  v1Json,
  v1ServerError,
} from "@/lib/api/v1-route";
import {
  getUsageSummary,
  parseUsageSummaryQueryRequest,
} from "@/lib/api/usage-summary";

export async function GET(req: Request) {
  return runV1Route(req, async () => {
    const parsed = parseUsageSummaryQueryRequest(req);
    if (!parsed.ok) return v1InvalidQuery();

    const w = parsed.data.window;

    try {
      return v1Json(await getUsageSummary(w));
    } catch (err) {
      return v1ServerError("api/v1/usage/summary", err);
    }
  });
}
