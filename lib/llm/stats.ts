/**
 * Rollup-backed LLM usage queries for the admin dashboard and agent API.
 *
 * The raw ledger has hundreds of thousands of rows and is append-only. Reading
 * it for every dashboard render made a cold admin request scan the whole table.
 * A trigger-maintained daily rollup keeps these reads exact while bounded
 * windows consult at most one partial boundary day from the raw ledger.
 */
import type { ResultSet, Row } from "@libsql/client";
import { libsqlClient } from "@/db/client";
import {
  USAGE_DAY_MS,
  usageBreakdownStatement,
  usageDailySpendStatement,
  usageTotalsStatement,
} from "@/lib/llm/usage-rollup-sql";

export const USAGE_WINDOWS = ["today", "week", "month", "all"] as const;
export type WindowKey = (typeof USAGE_WINDOWS)[number];

export type WindowTotals = {
  window: WindowKey;
  calls: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costUsd: number;
};

export type TaskBreakdown = {
  task: string | null;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  models: TaskModelBreakdown[];
};

type TaskModelBreakdown = {
  provider: string;
  model: string;
  calls: number;
  costUsd: number;
};

export type ModelBreakdown = {
  provider: string;
  model: string;
  calls: number;
  costUsd: number;
};

export type RecentCall = {
  id: number;
  task: string | null;
  provider: string;
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costUsd: number | null;
  durationMs: number | null;
  itemId: number | null;
  createdAt: Date;
};

export type DailySpendPoint = { date: string; spend: number; calls: number };

export type UsageWindowStats = {
  totals: WindowTotals;
  byTask: TaskBreakdown[];
  byModel: ModelBreakdown[];
  recentCalls: RecentCall[];
};

export type UsageDashboardStats = Omit<UsageWindowStats, "totals"> & {
  windowTotals: Record<WindowKey, WindowTotals>;
  dailySpend: DailySpendPoint[];
};

export async function getUsageWindowStats(
  window: WindowKey,
  opts: { recentLimit?: number } = {},
): Promise<UsageWindowStats> {
  const nowMs = Date.now();
  const [totalsResult, breakdownResult, recentResult] = await libsqlClient().batch(
    [
      usageTotalsStatement(window, nowMs),
      usageBreakdownStatement(window, nowMs),
      recentCallsStatement(opts.recentLimit ?? 10),
    ],
    "read",
  );
  const byTask = taskBreakdownFromResult(breakdownResult);
  return {
    totals: totalsFromResult(window, totalsResult),
    byTask,
    byModel: modelBreakdownFromTasks(byTask),
    recentCalls: recentCallsFromResult(recentResult),
  };
}

export async function getUsageDashboardStats(
  window: WindowKey,
  opts: { recentLimit?: number; dailyDays?: number } = {},
): Promise<UsageDashboardStats> {
  const nowMs = Date.now();
  const dailyDays = boundedPositiveInt(opts.dailyDays ?? 30, 366);
  const results = await libsqlClient().batch(
    [
      ...USAGE_WINDOWS.map((usageWindow) =>
        usageTotalsStatement(usageWindow, nowMs),
      ),
      usageBreakdownStatement(window, nowMs),
      recentCallsStatement(opts.recentLimit ?? 25),
      usageDailySpendStatement(dailyDays, nowMs),
    ],
    "read",
  );
  const totalsResults = results.slice(0, USAGE_WINDOWS.length);
  const breakdownResult = results[USAGE_WINDOWS.length]!;
  const recentResult = results[USAGE_WINDOWS.length + 1]!;
  const dailyResult = results[USAGE_WINDOWS.length + 2]!;
  const byTask = taskBreakdownFromResult(breakdownResult);

  return {
    windowTotals: Object.fromEntries(
      USAGE_WINDOWS.map((usageWindow, index) => [
        usageWindow,
        totalsFromResult(usageWindow, totalsResults[index]!),
      ]),
    ) as Record<WindowKey, WindowTotals>,
    byTask,
    byModel: modelBreakdownFromTasks(byTask),
    recentCalls: recentCallsFromResult(recentResult),
    dailySpend: dailySpendFromResult(dailyResult, dailyDays, nowMs),
  };
}

function recentCallsStatement(limit: number) {
  return {
    sql: `SELECT
            id, task, provider, model, input_tokens, cached_input_tokens,
            output_tokens, reasoning_tokens, cost_usd, duration_ms, item_id,
            created_at
          FROM llm_usage INDEXED BY llm_usage_created_at_idx
          ORDER BY created_at DESC
          LIMIT ?`,
    args: [boundedPositiveInt(limit, 100)],
  };
}

function totalsFromResult(
  window: WindowKey,
  result: ResultSet,
): WindowTotals {
  const row = result.rows[0];
  return {
    window,
    calls: numberValue(row?.calls),
    inputTokens: numberValue(row?.input_tokens),
    cachedInputTokens: numberValue(row?.cached_input_tokens),
    outputTokens: numberValue(row?.output_tokens),
    reasoningTokens: numberValue(row?.reasoning_tokens),
    costUsd: numberValue(row?.cost_usd),
  };
}

function taskBreakdownFromResult(result: ResultSet): TaskBreakdown[] {
  const byTask = new Map<string, TaskBreakdown>();
  for (const row of result.rows) {
    const task = nullableString(row.task);
    const key = task ?? "untagged";
    const calls = numberValue(row.calls);
    const inputTokens = numberValue(row.input_tokens);
    const outputTokens = numberValue(row.output_tokens);
    const costUsd = numberValue(row.cost_usd);
    const existing =
      byTask.get(key) ??
      ({
        task,
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        models: [],
      } satisfies TaskBreakdown);
    existing.calls += calls;
    existing.inputTokens += inputTokens;
    existing.outputTokens += outputTokens;
    existing.costUsd += costUsd;
    existing.models.push({
      provider: String(row.provider),
      model: String(row.model),
      calls,
      costUsd,
    });
    byTask.set(key, existing);
  }
  return [...byTask.values()].sort((left, right) => right.costUsd - left.costUsd);
}

function modelBreakdownFromTasks(tasks: readonly TaskBreakdown[]): ModelBreakdown[] {
  const byModel = new Map<string, ModelBreakdown>();
  for (const task of tasks) {
    for (const model of task.models) {
      const key = `${model.provider}\u0000${model.model}`;
      const existing = byModel.get(key) ?? {
        provider: model.provider,
        model: model.model,
        calls: 0,
        costUsd: 0,
      };
      existing.calls += model.calls;
      existing.costUsd += model.costUsd;
      byModel.set(key, existing);
    }
  }
  return [...byModel.values()].sort((left, right) => right.costUsd - left.costUsd);
}

function recentCallsFromResult(result: ResultSet): RecentCall[] {
  return result.rows.map((row) => ({
    id: numberValue(row.id),
    task: nullableString(row.task),
    provider: String(row.provider),
    model: String(row.model),
    inputTokens: numberValue(row.input_tokens),
    cachedInputTokens: numberValue(row.cached_input_tokens),
    outputTokens: numberValue(row.output_tokens),
    reasoningTokens: numberValue(row.reasoning_tokens),
    costUsd: nullableNumber(row.cost_usd),
    durationMs: nullableNumber(row.duration_ms),
    itemId: nullableNumber(row.item_id),
    createdAt: new Date(numberValue(row.created_at)),
  }));
}

function dailySpendFromResult(
  result: ResultSet,
  days: number,
  nowMs: number,
): DailySpendPoint[] {
  const byDay = new Map(
    result.rows.map((row) => [
      numberValue(row.day_idx),
      { spend: numberValue(row.spend), calls: numberValue(row.calls) },
    ]),
  );
  const todayDayIdx = Math.floor(nowMs / USAGE_DAY_MS);
  return Array.from({ length: days }, (_, index) => {
    const dayIdx = todayDayIdx - (days - 1 - index);
    const value = byDay.get(dayIdx);
    return {
      date: new Date(dayIdx * USAGE_DAY_MS).toISOString().slice(0, 10),
      spend: value?.spend ?? 0,
      calls: value?.calls ?? 0,
    };
  });
}

function boundedPositiveInt(value: number, max: number): number {
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, max) : 1;
}

function numberValue(value: Row[string] | undefined): number {
  return value == null ? 0 : Number(value);
}

function nullableNumber(value: Row[string] | undefined): number | null {
  return value == null ? null : Number(value);
}

function nullableString(value: Row[string] | undefined): string | null {
  return value == null || value === "" ? null : String(value);
}
