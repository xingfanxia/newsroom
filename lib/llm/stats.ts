/**
 * Aggregation queries over llm_usage for the admin dashboard.
 */
import { db } from "@/db/client";
import { sql, desc } from "drizzle-orm";
import { llmUsage } from "@/db/schema";

type WindowKey = "today" | "week" | "month" | "all";

function windowClause(w: WindowKey) {
  switch (w) {
    case "today":
      return sql`created_at >= date_trunc('day', now())`;
    case "week":
      return sql`created_at >= now() - interval '7 days'`;
    case "month":
      return sql`created_at >= now() - interval '30 days'`;
    case "all":
      return sql`true`;
  }
}

/**
 * drizzle-orm's `.execute(sql)` with postgres-js returns an array-like result
 * indexed by numeric keys (res[0], res[1], ...), NOT a {rows: [...]} wrapper
 * that pg/node-postgres uses. Earlier code assumed `.rows` and silently read
 * 0 for every aggregate. Normalize to a plain Record array here.
 */
function asRows(result: unknown): Record<string, unknown>[] {
  const r = result as unknown as
    | Record<string, unknown>[]
    | { rows?: Record<string, unknown>[] };
  if (Array.isArray(r)) return r;
  return r.rows ?? [];
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
  const result = await client.execute(sql`
    SELECT
      count(*)::int AS calls,
      coalesce(sum(input_tokens), 0)::int AS input_tokens,
      coalesce(sum(cached_input_tokens), 0)::int AS cached_input_tokens,
      coalesce(sum(output_tokens), 0)::int AS output_tokens,
      coalesce(sum(reasoning_tokens), 0)::int AS reasoning_tokens,
      coalesce(sum(cost_usd), 0)::float AS cost_usd
    FROM llm_usage WHERE ${windowClause(w)}
  `);
  const r = asRows(result)[0] ?? {};
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
};

export async function breakdownByTask(
  w: WindowKey = "week",
): Promise<TaskBreakdown[]> {
  const client = db();
  const result = await client.execute(sql`
    SELECT
      task,
      count(*)::int AS calls,
      coalesce(sum(input_tokens), 0)::int AS input_tokens,
      coalesce(sum(output_tokens), 0)::int AS output_tokens,
      coalesce(sum(cost_usd), 0)::float AS cost_usd
    FROM llm_usage WHERE ${windowClause(w)}
    GROUP BY task
    ORDER BY cost_usd DESC
  `);
  return asRows(result).map((r) => ({
    task: (r.task as string | null) ?? null,
    calls: Number(r.calls ?? 0),
    inputTokens: Number(r.input_tokens ?? 0),
    outputTokens: Number(r.output_tokens ?? 0),
    costUsd: Number(r.cost_usd ?? 0),
  }));
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
  const result = await client.execute(sql`
    SELECT
      provider, model,
      count(*)::int AS calls,
      coalesce(sum(cost_usd), 0)::float AS cost_usd
    FROM llm_usage WHERE ${windowClause(w)}
    GROUP BY provider, model
    ORDER BY cost_usd DESC
  `);
  return asRows(result).map((r) => ({
    provider: String(r.provider),
    model: String(r.model),
    calls: Number(r.calls ?? 0),
    costUsd: Number(r.cost_usd ?? 0),
  }));
}

export type RecentCall = {
  id: number;
  task: string | null;
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
  const result = await client.execute(sql`
    WITH series AS (
      SELECT to_char(d::date, 'YYYY-MM-DD') AS date
      FROM generate_series(
        (now() - (${days - 1} * interval '1 day'))::date,
        now()::date,
        interval '1 day'
      ) AS d
    )
    SELECT
      s.date,
      coalesce(sum(u.cost_usd), 0)::float AS spend,
      coalesce(count(u.id), 0)::int AS calls
    FROM series s
    LEFT JOIN llm_usage u
      ON to_char(date_trunc('day', u.created_at), 'YYYY-MM-DD') = s.date
    GROUP BY s.date
    ORDER BY s.date ASC
  `);
  return asRows(result).map((r) => ({
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
