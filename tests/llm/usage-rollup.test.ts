import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  CREATE_USAGE_ROLLUP_TABLE_SQL,
  CREATE_USAGE_ROLLUP_TRIGGER_SQL,
  REBUILD_USAGE_ROLLUP_SQL,
  USAGE_DAY_MS,
  usageBreakdownStatement,
  usageDailySpendStatement,
  usageTotalsStatement,
} from "@/lib/llm/usage-rollup-sql";

const NOW_MS = Date.UTC(2026, 6, 16, 12);
let root: string;
let client: Client;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "newsroom-usage-rollup-"));
  client = createClient({ url: `file:${join(root, "usage.sqlite")}` });
  await client.executeMultiple(`
    CREATE TABLE llm_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      task TEXT,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      cached_input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      reasoning_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL,
      item_id INTEGER,
      duration_ms INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX llm_usage_created_at_idx ON llm_usage (created_at);
    CREATE INDEX llm_usage_totals_cover_idx ON llm_usage (
      created_at, input_tokens, cached_input_tokens,
      output_tokens, reasoning_tokens, cost_usd
    );
  `);
  await client.batch(
    [
      usageInsert(NOW_MS - 8 * USAGE_DAY_MS, "older", 1),
      usageInsert(NOW_MS - 7 * USAGE_DAY_MS + 1, "week-edge", 2),
      usageInsert(NOW_MS - 6 * USAGE_DAY_MS, "week", 3),
      usageInsert(NOW_MS - 60 * 60 * 1000, null, 4),
    ],
    "write",
  );
  await client.batch(
    [
      CREATE_USAGE_ROLLUP_TABLE_SQL,
      CREATE_USAGE_ROLLUP_TRIGGER_SQL,
      REBUILD_USAGE_ROLLUP_SQL,
    ],
    "write",
  );
});

afterEach(async () => {
  client.close();
  await rm(root, { recursive: true, force: true });
});

describe("LLM usage daily rollup", () => {
  test("preserves exact rolling-window totals with one raw boundary day", async () => {
    const [week, all] = await client.batch(
      [
        usageTotalsStatement("week", NOW_MS),
        usageTotalsStatement("all", NOW_MS),
      ],
      "read",
    );

    expect(Number(week.rows[0]?.calls)).toBe(3);
    expect(Number(week.rows[0]?.input_tokens)).toBe(90);
    expect(Number(week.rows[0]?.cost_usd)).toBeCloseTo(0.09);
    expect(Number(all.rows[0]?.calls)).toBe(4);
  });

  test("serves task/model breakdowns and daily chart buckets from the rollup", async () => {
    const [breakdown, daily] = await client.batch(
      [
        usageBreakdownStatement("week", NOW_MS),
        usageDailySpendStatement(30, NOW_MS),
      ],
      "read",
    );

    expect(
      breakdown.rows.reduce((sum, row) => sum + Number(row.calls), 0),
    ).toBe(3);
    expect(breakdown.rows.some((row) => row.task === null)).toBeTrue();
    expect(daily.rows.reduce((sum, row) => sum + Number(row.calls), 0)).toBe(4);
  });

  test("increments the aggregate for every new raw ledger insert", async () => {
    await client.execute(usageInsert(NOW_MS, "week", 5));
    const result = await client.execute(usageTotalsStatement("today", NOW_MS));

    expect(Number(result.rows[0]?.calls)).toBe(2);
    expect(Number(result.rows[0]?.input_tokens)).toBe(90);
    expect(Number(result.rows[0]?.cost_usd)).toBeCloseTo(0.09);
  });
});

function usageInsert(createdAt: number, task: string | null, multiplier: number) {
  return {
    sql: `INSERT INTO llm_usage (
            provider, model, task, input_tokens, cached_input_tokens,
            output_tokens, reasoning_tokens, cost_usd, duration_ms, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      "openai",
      "gpt-test",
      task,
      10 * multiplier,
      multiplier,
      2 * multiplier,
      multiplier,
      0.01 * multiplier,
      100,
      createdAt,
    ],
  };
}
