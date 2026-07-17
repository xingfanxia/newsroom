import type { InStatement } from "@libsql/client";

export const USAGE_DAY_MS = 86_400_000;

export const CREATE_USAGE_ROLLUP_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS llm_usage_daily_rollups (
    day_idx INTEGER NOT NULL,
    task TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    calls INTEGER NOT NULL,
    input_tokens INTEGER NOT NULL,
    cached_input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    reasoning_tokens INTEGER NOT NULL,
    cost_usd REAL NOT NULL,
    PRIMARY KEY (day_idx, task, provider, model)
  ) WITHOUT ROWID`;

export const CREATE_USAGE_ROLLUP_TRIGGER_SQL = `
  CREATE TRIGGER IF NOT EXISTS llm_usage_daily_rollup_ai
  AFTER INSERT ON llm_usage
  BEGIN
    INSERT INTO llm_usage_daily_rollups (
      day_idx, task, provider, model, calls, input_tokens,
      cached_input_tokens, output_tokens, reasoning_tokens, cost_usd
    ) VALUES (
      NEW.created_at / 86400000,
      coalesce(NEW.task, ''),
      NEW.provider,
      NEW.model,
      1,
      NEW.input_tokens,
      NEW.cached_input_tokens,
      NEW.output_tokens,
      NEW.reasoning_tokens,
      coalesce(NEW.cost_usd, 0)
    )
    ON CONFLICT (day_idx, task, provider, model) DO UPDATE SET
      calls = calls + excluded.calls,
      input_tokens = input_tokens + excluded.input_tokens,
      cached_input_tokens = cached_input_tokens + excluded.cached_input_tokens,
      output_tokens = output_tokens + excluded.output_tokens,
      reasoning_tokens = reasoning_tokens + excluded.reasoning_tokens,
      cost_usd = cost_usd + excluded.cost_usd;
  END`;

export const REBUILD_USAGE_ROLLUP_SQL = `
  INSERT INTO llm_usage_daily_rollups (
    day_idx, task, provider, model, calls, input_tokens,
    cached_input_tokens, output_tokens, reasoning_tokens, cost_usd
  )
  SELECT
    created_at / 86400000 AS day_idx,
    coalesce(task, '') AS task,
    provider,
    model,
    count(*) AS calls,
    coalesce(sum(input_tokens), 0) AS input_tokens,
    coalesce(sum(cached_input_tokens), 0) AS cached_input_tokens,
    coalesce(sum(output_tokens), 0) AS output_tokens,
    coalesce(sum(reasoning_tokens), 0) AS reasoning_tokens,
    coalesce(sum(cost_usd), 0) AS cost_usd
  FROM llm_usage INDEXED BY llm_usage_totals_cover_idx
  GROUP BY day_idx, task, provider, model`;

export type UsageRollupWindow = "today" | "week" | "month" | "all";

type WindowBounds = {
  startMs: number | null;
  firstFullDayIdx: number | null;
  edgeEndMs: number | null;
};

function windowBounds(window: UsageRollupWindow, nowMs: number): WindowBounds {
  if (window === "all") {
    return { startMs: null, firstFullDayIdx: null, edgeEndMs: null };
  }
  if (window === "today") {
    const startMs = nowMs - (nowMs % USAGE_DAY_MS);
    return {
      startMs,
      firstFullDayIdx: Math.floor(startMs / USAGE_DAY_MS),
      edgeEndMs: null,
    };
  }

  const days = window === "week" ? 7 : 30;
  const startMs = nowMs - days * USAGE_DAY_MS;
  const boundaryDayIdx = Math.floor(startMs / USAGE_DAY_MS);
  return {
    startMs,
    firstFullDayIdx: boundaryDayIdx + 1,
    edgeEndMs: (boundaryDayIdx + 1) * USAGE_DAY_MS,
  };
}

const TOTAL_COLUMNS = `
  count(*) AS calls,
  coalesce(sum(input_tokens), 0) AS input_tokens,
  coalesce(sum(cached_input_tokens), 0) AS cached_input_tokens,
  coalesce(sum(output_tokens), 0) AS output_tokens,
  coalesce(sum(reasoning_tokens), 0) AS reasoning_tokens,
  coalesce(sum(cost_usd), 0) AS cost_usd`;

const ROLLUP_TOTAL_COLUMNS = `
  coalesce(sum(calls), 0) AS calls,
  coalesce(sum(input_tokens), 0) AS input_tokens,
  coalesce(sum(cached_input_tokens), 0) AS cached_input_tokens,
  coalesce(sum(output_tokens), 0) AS output_tokens,
  coalesce(sum(reasoning_tokens), 0) AS reasoning_tokens,
  coalesce(sum(cost_usd), 0) AS cost_usd`;

export function usageTotalsStatement(
  window: UsageRollupWindow,
  nowMs: number,
): InStatement {
  const bounds = windowBounds(window, nowMs);
  if (window === "all") {
    return {
      sql: `SELECT ${ROLLUP_TOTAL_COLUMNS} FROM llm_usage_daily_rollups`,
      args: [],
    };
  }
  if (window === "today") {
    return {
      sql: `SELECT ${ROLLUP_TOTAL_COLUMNS}
            FROM llm_usage_daily_rollups WHERE day_idx >= ?`,
      args: [bounds.firstFullDayIdx!],
    };
  }

  return {
    sql: `WITH rollup AS (
            SELECT ${ROLLUP_TOTAL_COLUMNS}
            FROM llm_usage_daily_rollups WHERE day_idx >= ?
          ), edge AS (
            SELECT ${TOTAL_COLUMNS}
            FROM llm_usage INDEXED BY llm_usage_totals_cover_idx
            WHERE created_at >= ? AND created_at < ?
          )
          SELECT
            rollup.calls + edge.calls AS calls,
            rollup.input_tokens + edge.input_tokens AS input_tokens,
            rollup.cached_input_tokens + edge.cached_input_tokens AS cached_input_tokens,
            rollup.output_tokens + edge.output_tokens AS output_tokens,
            rollup.reasoning_tokens + edge.reasoning_tokens AS reasoning_tokens,
            rollup.cost_usd + edge.cost_usd AS cost_usd
          FROM rollup CROSS JOIN edge`,
    args: [bounds.firstFullDayIdx!, bounds.startMs!, bounds.edgeEndMs!],
  };
}

export function usageBreakdownStatement(
  window: UsageRollupWindow,
  nowMs: number,
): InStatement {
  const bounds = windowBounds(window, nowMs);
  const rollupWhere =
    window === "all" ? "" : "WHERE day_idx >= ?";
  const rollupArgs =
    window === "all" ? [] : [bounds.firstFullDayIdx!];

  if (window === "today" || window === "all") {
    return {
      sql: `SELECT
              nullif(task, '') AS task,
              provider,
              model,
              sum(calls) AS calls,
              sum(input_tokens) AS input_tokens,
              sum(output_tokens) AS output_tokens,
              sum(cost_usd) AS cost_usd
            FROM llm_usage_daily_rollups ${rollupWhere}
            GROUP BY task, provider, model
            ORDER BY cost_usd DESC`,
      args: rollupArgs,
    };
  }

  return {
    sql: `WITH combined AS (
            SELECT task, provider, model, calls, input_tokens,
                   output_tokens, cost_usd
            FROM llm_usage_daily_rollups WHERE day_idx >= ?
            UNION ALL
            SELECT
              coalesce(task, '') AS task,
              provider,
              model,
              count(*) AS calls,
              coalesce(sum(input_tokens), 0) AS input_tokens,
              coalesce(sum(output_tokens), 0) AS output_tokens,
              coalesce(sum(cost_usd), 0) AS cost_usd
            FROM llm_usage INDEXED BY llm_usage_created_at_idx
            WHERE created_at >= ? AND created_at < ?
            GROUP BY task, provider, model
          )
          SELECT
            nullif(task, '') AS task,
            provider,
            model,
            sum(calls) AS calls,
            sum(input_tokens) AS input_tokens,
            sum(output_tokens) AS output_tokens,
            sum(cost_usd) AS cost_usd
          FROM combined
          GROUP BY task, provider, model
          ORDER BY cost_usd DESC`,
    args: [bounds.firstFullDayIdx!, bounds.startMs!, bounds.edgeEndMs!],
  };
}

export function usageDailySpendStatement(
  days: number,
  nowMs: number,
): InStatement {
  const todayDayIdx = Math.floor(nowMs / USAGE_DAY_MS);
  return {
    sql: `SELECT day_idx, sum(cost_usd) AS spend, sum(calls) AS calls
          FROM llm_usage_daily_rollups
          WHERE day_idx >= ? AND day_idx <= ?
          GROUP BY day_idx
          ORDER BY day_idx ASC`,
    args: [todayDayIdx - (days - 1), todayDayIdx],
  };
}
