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
import { z } from "zod";
import {
  runV1Route,
  v1Error,
  v1InvalidQuery,
  v1Json,
} from "@/lib/api/v1-route";
import {
  getUsageSummary,
  USAGE_WINDOWS,
} from "@/lib/api/usage-summary";

const querySchema = z.object({
  window: z.enum(USAGE_WINDOWS).optional().default("week"),
});

export async function GET(req: Request) {
  return runV1Route(req, async () => {
    const url = new URL(req.url);
    const parsed = querySchema.safeParse(
      Object.fromEntries(url.searchParams.entries()),
    );
    if (!parsed.success) return v1InvalidQuery();

    const w = parsed.data.window;

    try {
      return v1Json(await getUsageSummary(w));
    } catch (err) {
      console.error("[api/v1/usage/summary] failed", err);
      return v1Error("server_error", 500);
    }
  });
}
