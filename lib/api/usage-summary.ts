import { z } from "zod";
import { parseQueryParams } from "@/lib/api/query-params";
import {
  getUsageDashboardStats,
  getUsageWindowStats,
  USAGE_WINDOWS,
  type DailySpendPoint,
  type ModelBreakdown,
  type RecentCall,
  type TaskBreakdown,
  type WindowKey,
  type WindowTotals,
} from "@/lib/llm/stats";
export { USAGE_WINDOWS } from "@/lib/llm/stats";
export type { WindowKey, WindowTotals } from "@/lib/llm/stats";

const DEFAULT_USAGE_WINDOW = "week" satisfies WindowKey;
export const usageSummaryWindowSchema = z.enum(USAGE_WINDOWS).optional();
const usageSummaryQuerySchema = z.object({
  window: usageSummaryWindowSchema.default(DEFAULT_USAGE_WINDOW),
});

export function usageWindowOrDefault(window: WindowKey | undefined): WindowKey {
  return window ?? DEFAULT_USAGE_WINDOW;
}

export function usageWindowFromParam(
  window: string | null | undefined,
): WindowKey {
  const parsed = usageSummaryWindowSchema.safeParse(window ?? undefined);
  return parsed.success ? usageWindowOrDefault(parsed.data) : DEFAULT_USAGE_WINDOW;
}

export function parseUsageSummaryQueryRequest(req: Request) {
  return parseQueryParams(req, usageSummaryQuerySchema);
}

export type UsageSummaryApi = {
  window: WindowKey;
  totals: {
    calls: number;
    cost_usd: number;
    input_tokens: number;
    cached_input_tokens: number;
    output_tokens: number;
    reasoning_tokens: number;
  };
  by_task: Array<{
    task: string | null;
    calls: number;
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
    models: Array<{
      provider: string;
      model: string;
      calls: number;
      cost_usd: number;
    }>;
  }>;
  by_model: Array<{
    provider: string;
    model: string;
    calls: number;
    cost_usd: number;
  }>;
  recent_calls: Array<{
    id: number;
    task: string | null;
    provider: string;
    model: string;
    input_tokens: number;
    cached_input_tokens: number;
    output_tokens: number;
    reasoning_tokens: number;
    cost_usd: number | null;
    duration_ms: number | null;
    item_id: number | null;
    created_at: string;
  }>;
};

export type UsageDashboardSummary = {
  selected: WindowTotals;
  windowTotals: Record<WindowKey, WindowTotals | null>;
  byTask: TaskBreakdown[];
  byModel: ModelBreakdown[];
  recentCalls: RecentCall[];
  dailySpend: DailySpendPoint[];
};

export function toUsageSummaryApi(args: {
  totals: WindowTotals;
  byTask: TaskBreakdown[];
  byModel: ModelBreakdown[];
  recentCalls: RecentCall[];
}): UsageSummaryApi {
  return {
    window: args.totals.window,
    totals: {
      calls: args.totals.calls,
      cost_usd: args.totals.costUsd,
      input_tokens: args.totals.inputTokens,
      cached_input_tokens: args.totals.cachedInputTokens,
      output_tokens: args.totals.outputTokens,
      reasoning_tokens: args.totals.reasoningTokens,
    },
    by_task: args.byTask.map((t) => ({
      task: t.task,
      calls: t.calls,
      input_tokens: t.inputTokens,
      output_tokens: t.outputTokens,
      cost_usd: t.costUsd,
      models: t.models.map((m) => ({
        provider: m.provider,
        model: m.model,
        calls: m.calls,
        cost_usd: m.costUsd,
      })),
    })),
    by_model: args.byModel.map((m) => ({
      provider: m.provider,
      model: m.model,
      calls: m.calls,
      cost_usd: m.costUsd,
    })),
    recent_calls: args.recentCalls.map((c) => ({
      id: c.id,
      task: c.task,
      provider: c.provider,
      model: c.model,
      input_tokens: c.inputTokens,
      cached_input_tokens: c.cachedInputTokens,
      output_tokens: c.outputTokens,
      reasoning_tokens: c.reasoningTokens,
      cost_usd: c.costUsd,
      duration_ms: c.durationMs,
      item_id: c.itemId,
      created_at: c.createdAt.toISOString(),
    })),
  };
}

export function toUsageWindowTotalsRecord(
  totals: readonly (WindowTotals | null)[],
): Record<WindowKey, WindowTotals | null> {
  return Object.fromEntries(
    USAGE_WINDOWS.map((usageWindow, index) => [
      usageWindow,
      totals[index] ?? null,
    ]),
  ) as Record<WindowKey, WindowTotals | null>;
}

export function emptyUsageWindowTotals(window: WindowKey): WindowTotals {
  return {
    window,
    calls: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    costUsd: 0,
  };
}

export async function getUsageSummary(
  window: WindowKey = DEFAULT_USAGE_WINDOW,
  opts: { recentLimit?: number } = {},
): Promise<UsageSummaryApi> {
  const stats = await getUsageWindowStats(window, opts);
  return toUsageSummaryApi({
    totals: stats.totals,
    byTask: stats.byTask,
    byModel: stats.byModel,
    recentCalls: stats.recentCalls,
  });
}

export async function getUsageDashboardSummary(
  window: WindowKey = DEFAULT_USAGE_WINDOW,
  opts: { recentLimit?: number; dailyDays?: number } = {},
): Promise<UsageDashboardSummary> {
  const stats = await getUsageDashboardStats(window, opts);

  return {
    selected: stats.windowTotals[window],
    windowTotals: stats.windowTotals,
    byTask: stats.byTask,
    byModel: stats.byModel,
    recentCalls: stats.recentCalls,
    dailySpend: stats.dailySpend,
  };
}
