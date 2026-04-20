/**
 * GET /api/v1/usage/summary — LLM spend + token mix + task breakdown.
 *
 * Wraps the existing /admin/usage data in an agent-readable flat shape
 * so a careful agent can check "do we have budget before I fire a batch?"
 * before spending real money.
 *
 * Fields are all lifetime-to-date counters scoped to the specified window.
 * Window = today | week | month (default week).
 */
import { z } from "zod";
import { requireApiToken } from "@/lib/auth/api-token";
import { breakdownByTask, totalsByWindow } from "@/lib/llm/stats";

const querySchema = z.object({
  window: z.enum(["today", "week", "month"]).optional().default("week"),
});

export async function GET(req: Request) {
  const auth = await requireApiToken(req);
  if (auth instanceof Response) return auth;

  const url = new URL(req.url);
  const parsed = querySchema.safeParse(
    Object.fromEntries(url.searchParams.entries()),
  );
  if (!parsed.success) {
    return Response.json({ error: "invalid_query" }, { status: 400 });
  }
  const w = parsed.data.window;

  try {
    const [totals, byTask] = await Promise.all([
      totalsByWindow(w),
      breakdownByTask(w),
    ]);
    return Response.json({
      window: w,
      totals: {
        calls: totals.calls,
        cost_usd: totals.costUsd,
        input_tokens: totals.inputTokens,
        cached_input_tokens: totals.cachedInputTokens,
        output_tokens: totals.outputTokens,
        reasoning_tokens: totals.reasoningTokens,
      },
      by_task: byTask.map((t) => ({
        task: t.task,
        calls: t.calls,
        cost_usd: t.costUsd,
      })),
    });
  } catch (err) {
    console.error("[api/v1/usage/summary] failed", err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
