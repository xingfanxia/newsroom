import {
  breakdownByModel,
  breakdownByTask,
  dailySpend,
  recentCalls,
  totalsByWindow,
  type DailySpendPoint,
  type ModelBreakdown,
  type RecentCall,
  type TaskBreakdown,
  type WindowKey,
  type WindowTotals,
} from "@/lib/llm/stats";
export { USAGE_WINDOWS } from "@/lib/llm/stats";
export type { WindowKey, WindowTotals } from "@/lib/llm/stats";

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

export async function getUsageSummary(
  window: WindowKey = "week",
  opts: { recentLimit?: number } = {},
): Promise<UsageSummaryApi> {
  const [totals, byTask, byModel, recent] = await Promise.all([
    totalsByWindow(window),
    breakdownByTask(window),
    breakdownByModel(window),
    recentCalls(opts.recentLimit ?? 10),
  ]);
  return toUsageSummaryApi({
    totals,
    byTask,
    byModel,
    recentCalls: recent,
  });
}

export async function getUsageDashboardSummary(
  window: WindowKey = "week",
  opts: { recentLimit?: number; dailyDays?: number } = {},
): Promise<UsageDashboardSummary> {
  const [selected, today, week, month, all, byTask, byModel, recent, daily] =
    await Promise.all([
      totalsByWindow(window),
      withUsageFallback(totalsByWindow("today"), null),
      withUsageFallback(totalsByWindow("week"), null),
      withUsageFallback(totalsByWindow("month"), null),
      withUsageFallback(totalsByWindow("all"), null),
      withUsageFallback(breakdownByTask(window), []),
      withUsageFallback(breakdownByModel(window), []),
      withUsageFallback(recentCalls(opts.recentLimit ?? 25), []),
      withUsageFallback(dailySpend(opts.dailyDays ?? 30), []),
    ]);

  return {
    selected,
    windowTotals: { today, week, month, all },
    byTask,
    byModel,
    recentCalls: recent,
    dailySpend: daily,
  };
}

async function withUsageFallback<T>(
  promise: Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await promise;
  } catch {
    return fallback;
  }
}
