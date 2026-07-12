/**
 * Aggregation queries over llm_usage for the admin dashboard.
 */
import { db } from "@/db/client";
import { sql, desc } from "drizzle-orm";
import { llmUsage } from "@/db/schema";

export const USAGE_WINDOWS = ["today", "week", "month", "all"] as const;
export type WindowKey = (typeof USAGE_WINDOWS)[number];

function windowClause(w: WindowKey) {
  // created_at is integer ms epoch (Turso migration); windows are computed
  // in JS and bound as numbers. "today" is UTC-day-aligned like the old
  // date_trunc('day', now()).
  const startOfUtcDayMs = Date.now() - (Date.now() % 86_400_000);
  switch (w) {
    case "today":
      return sql`created_at >= ${startOfUtcDayMs}`;
    case "week":
      return sql`created_at >= ${Date.now() - 7 * 86_400_000}`;
    case "month":
      return sql`created_at >= ${Date.now() - 30 * 86_400_000}`;
    case "all":
      return sql`true`;
  }
}

export type WindowTotals = {
  window: WindowKey;
  calls: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costUsd: number;
};

export async function totalsByWindow(
  w: WindowKey = "today",
): Promise<WindowTotals> {
  const client = db();
  const result = await client.all<Record<string, unknown>>(sql`
    SELECT
      count(*) AS calls,
      coalesce(sum(input_tokens), 0) AS input_tokens,
      coalesce(sum(cached_input_tokens), 0) AS cached_input_tokens,
      coalesce(sum(output_tokens), 0) AS output_tokens,
      coalesce(sum(reasoning_tokens), 0) AS reasoning_tokens,
      coalesce(sum(cost_usd), 0) AS cost_usd
    FROM llm_usage WHERE ${windowClause(w)}
  `);
  const r = result[0] ?? {};
  return {
    window: w,
    calls: Number(r.calls ?? 0),
    inputTokens: Number(r.input_tokens ?? 0),
    cachedInputTokens: Number(r.cached_input_tokens ?? 0),
    outputTokens: Number(r.output_tokens ?? 0),
    reasoningTokens: Number(r.reasoning_tokens ?? 0),
    costUsd: Number(r.cost_usd ?? 0),
  };
}

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

export async function breakdownByTask(
  w: WindowKey = "week",
): Promise<TaskBreakdown[]> {
  const client = db();
  const result = await client.all<Record<string, unknown>>(sql`
    SELECT
      task, provider, model,
      count(*) AS calls,
      coalesce(sum(input_tokens), 0) AS input_tokens,
      coalesce(sum(output_tokens), 0) AS output_tokens,
      coalesce(sum(cost_usd), 0) AS cost_usd
    FROM llm_usage WHERE ${windowClause(w)}
    GROUP BY task, provider, model
    ORDER BY cost_usd DESC
  `);
  const byTask = new Map<string, TaskBreakdown>();
  for (const r of result) {
    const task = (r.task as string | null) ?? null;
    const key = task ?? "untagged";
    const calls = Number(r.calls ?? 0);
    const inputTokens = Number(r.input_tokens ?? 0);
    const outputTokens = Number(r.output_tokens ?? 0);
    const costUsd = Number(r.cost_usd ?? 0);
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
      provider: String(r.provider),
      model: String(r.model),
      calls,
      costUsd,
    });
    byTask.set(key, existing);
  }
  return Array.from(byTask.values()).sort((a, b) => b.costUsd - a.costUsd);
}

export type ModelBreakdown = {
  provider: string;
  model: string;
  calls: number;
  costUsd: number;
};

export async function breakdownByModel(
  w: WindowKey = "week",
): Promise<ModelBreakdown[]> {
  const client = db();
  const result = await client.all<Record<string, unknown>>(sql`
    SELECT
      provider, model,
      count(*) AS calls,
      coalesce(sum(cost_usd), 0) AS cost_usd
    FROM llm_usage WHERE ${windowClause(w)}
    GROUP BY provider, model
    ORDER BY cost_usd DESC
  `);
  return result.map((r) => ({
    provider: String(r.provider),
    model: String(r.model),
    calls: Number(r.calls ?? 0),
    costUsd: Number(r.cost_usd ?? 0),
  }));
}

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

/** Daily-spend series for the usage page sparkline. Returns last `days`
 *  buckets newest-first-by-default, each with its ISO date + spend. Zeroes
 *  fill gaps so the bar chart keeps a stable width. */
export type DailySpendPoint = { date: string; spend: number; calls: number };
export async function dailySpend(days = 30): Promise<DailySpendPoint[]> {
  const client = db();
  // SQLite has no generate_series by default — build the day list in JS and
  // unnest it with json_each. Days are UTC-aligned like the old ::date.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const dayList = Array.from({ length: days }, (_, i) =>
    new Date(today.getTime() - (days - 1 - i) * 86_400_000)
      .toISOString()
      .slice(0, 10),
  );
  const result = await client.all<Record<string, unknown>>(sql`
    SELECT
      s.value AS date,
      coalesce(sum(u.cost_usd), 0) AS spend,
      coalesce(count(u.id), 0) AS calls
    FROM json_each(${JSON.stringify(dayList)}) s
    LEFT JOIN llm_usage u
      ON strftime('%Y-%m-%d', u.created_at / 1000.0, 'unixepoch') = s.value
    GROUP BY s.value
    ORDER BY s.value ASC
  `);
  return result.map((r) => ({
    date: String(r.date),
    spend: Number(r.spend ?? 0),
    calls: Number(r.calls ?? 0),
  }));
}

export async function recentCalls(limit = 25): Promise<RecentCall[]> {
  const client = db();
  const rows = await client
    .select({
      id: llmUsage.id,
      task: llmUsage.task,
      provider: llmUsage.provider,
      model: llmUsage.model,
      inputTokens: llmUsage.inputTokens,
      cachedInputTokens: llmUsage.cachedInputTokens,
      outputTokens: llmUsage.outputTokens,
      reasoningTokens: llmUsage.reasoningTokens,
      costUsd: llmUsage.costUsd,
      durationMs: llmUsage.durationMs,
      itemId: llmUsage.itemId,
      createdAt: llmUsage.createdAt,
    })
    .from(llmUsage)
    .orderBy(desc(llmUsage.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    ...r,
    costUsd: r.costUsd !== null ? Number(r.costUsd) : null,
  }));
}
