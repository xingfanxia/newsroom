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
  v1InvalidQueryResult,
  v1Json,
} from "@/lib/api/v1-route";
import {
  getUsageSummary,
  parseUsageSummaryQueryRequest,
} from "@/lib/api/usage-summary";

export async function GET(req: Request) {
  return runV1Route(req, async () => {
    const parsed = v1InvalidQueryResult(parseUsageSummaryQueryRequest(req), {
      includeIssues: false,
    });
    if (!parsed.ok) return parsed.response;

    const w = parsed.data.window;
    return v1Json(await getUsageSummary(w));
  }, { serverErrorLabel: "api/v1/usage/summary" });
}
