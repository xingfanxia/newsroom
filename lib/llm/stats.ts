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
  // T7 (2026-07-12 review finding 2c): renders on the same admin usage page as
  // the breakdowns; the 'all' window would otherwise full-scan the fat table.
  // Pin the covering index (created_at leading → bounded windows still prune,
  // 'all' stays inside the index with no fat-row lookups).
  const result = await client.all<Record<string, unknown>>(sql`
    SELECT
      count(*) AS calls,
      coalesce(sum(input_tokens), 0) AS input_tokens,
      coalesce(sum(cached_input_tokens), 0) AS cached_input_tokens,
      coalesce(sum(output_tokens), 0) AS output_tokens,
      coalesce(sum(reasoning_tokens), 0) AS reasoning_tokens,
      coalesce(sum(cost_usd), 0) AS cost_usd
    FROM llm_usage INDEXED BY llm_usage_totals_cover_idx WHERE ${windowClause(w)}
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
  // T7 (and the 2026-07-12 review): the two new llm_usage covering indexes are
  // group-ordered candidates the stat-less Turso planner might now prefer over
  // the created_at range index for bounded windows — which would drop the
  // range prune and scan the whole index. Pin explicitly per window: all-time
  // has no range to prune (covering index); bounded windows must keep the
  // created_at prune.
  const fromClause =
    w === "all"
      ? sql`llm_usage INDEXED BY llm_usage_breakdown_cover_idx`
      : sql`llm_usage INDEXED BY llm_usage_created_at_idx`;
  const result = await client.all<Record<string, unknown>>(sql`
    SELECT
      task, provider, model,
      count(*) AS calls,
      coalesce(sum(input_tokens), 0) AS input_tokens,
      coalesce(sum(output_tokens), 0) AS output_tokens,
      coalesce(sum(cost_usd), 0) AS cost_usd
    FROM ${fromClause} WHERE ${windowClause(w)}
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
  // T7: for the all-time window there's no created_at range to prune on, so the
  // GROUP BY would scan the fat table (audit: ~4.1s). Pin the covering index
  // (provider, model, cost_usd) so the scan stays inside it. Bounded windows
  // pin created_at instead so the range prune survives (the new covering
  // indexes are group-ordered candidates the stat-less planner might otherwise
  // prefer, losing the prune — 2026-07-12 review finding 2a).
  const fromClause =
    w === "all"
      ? sql`llm_usage INDEXED BY llm_usage_model_cover_idx`
      : sql`llm_usage INDEXED BY llm_usage_created_at_idx`;
  const result = await client.all<Record<string, unknown>>(sql`
    SELECT
      provider, model,
      count(*) AS calls,
      coalesce(sum(cost_usd), 0) AS cost_usd
    FROM ${fromClause} WHERE ${windowClause(w)}
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

/** Daily-spend series for the usage page sparkline. Returns the last `days`
 *  buckets oldest-first (ORDER BY date ASC), each with its ISO date + spend.
 *  Zeroes fill gaps so the bar chart keeps a stable width. */
export type DailySpendPoint = { date: string; spend: number; calls: number };
export async function dailySpend(days = 30): Promise<DailySpendPoint[]> {
  const client = db();
  // SQLite has no generate_series — build the day list in JS and unnest with
  // json_each. Days are UTC-aligned like the old ::date.
  //
  // Perf (T7): the previous version JOINed on
  // `strftime('%Y-%m-%d', created_at/1000.0, 'unixepoch') = s.value`, a
  // function on the column that forced a full 364k-row scan every page load
  // (~39s). Now: (1) each day carries its integer UTC-day index (ms / 86.4M)
  // so bucketing is plain integer division, and (2) a lower bound on created_at
  // lets the planner prune via llm_usage_created_at_idx. Turso is stat-less
  // (rejects ANALYZE — see db-optimize.ts) so the bound is explicit and the
  // index is pinned. 86400000 is written as a SQL literal (not a bound param)
  // to keep the division integer.
  const DAY_MS = 86_400_000;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const dayList = Array.from({ length: days }, (_, i) => {
    const ms = today.getTime() - (days - 1 - i) * DAY_MS;
    return { d: new Date(ms).toISOString().slice(0, 10), i: Math.floor(ms / DAY_MS) };
  });
  const minBoundMs = today.getTime() - (days - 1) * DAY_MS;
  const result = await client.all<Record<string, unknown>>(sql`
    SELECT
      json_extract(s.value, '$.d') AS date,
      coalesce(agg.spend, 0) AS spend,
      coalesce(agg.calls, 0) AS calls
    FROM json_each(${JSON.stringify(dayList)}) s
    LEFT JOIN (
      SELECT
        created_at / 86400000 AS day_idx,
        sum(cost_usd) AS spend,
        count(id) AS calls
      FROM llm_usage INDEXED BY llm_usage_created_at_idx
      WHERE created_at >= ${minBoundMs}
      GROUP BY day_idx
    ) agg ON agg.day_idx = json_extract(s.value, '$.i')
    ORDER BY date ASC
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
