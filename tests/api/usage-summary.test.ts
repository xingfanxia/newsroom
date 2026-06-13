import { describe, expect, test } from "bun:test";
import {
  parseUsageSummaryQueryRequest,
  toUsageSummaryApi,
  usageWindowOrDefault,
} from "@/lib/api/usage-summary";

describe("usage summary API serialization", () => {
  test("serializes totals, task/model breakdowns, and recent calls for agents", () => {
    const createdAt = new Date("2026-06-12T20:17:06.517Z");

    expect(
      toUsageSummaryApi({
        totals: {
          window: "week",
          calls: 12,
          inputTokens: 1200,
          cachedInputTokens: 300,
          outputTokens: 450,
          reasoningTokens: 50,
          costUsd: 1.25,
        },
        byTask: [
          {
            task: "enrich",
            calls: 7,
            inputTokens: 900,
            outputTokens: 250,
            costUsd: 0.75,
            models: [
              {
                provider: "azure-deepseek",
                model: "DeepSeek-V4-Flash",
                calls: 7,
                costUsd: 0.75,
              },
            ],
          },
        ],
        byModel: [
          {
            provider: "azure-deepseek",
            model: "DeepSeek-V4-Flash",
            calls: 7,
            costUsd: 0.75,
          },
        ],
        recentCalls: [
          {
            id: 42,
            task: "enrich",
            provider: "azure-deepseek",
            model: "DeepSeek-V4-Flash",
            inputTokens: 100,
            cachedInputTokens: 25,
            outputTokens: 30,
            reasoningTokens: 0,
            costUsd: 0.0123,
            durationMs: 1500,
            itemId: 99,
            createdAt,
          },
        ],
      }),
    ).toEqual({
      window: "week",
      totals: {
        calls: 12,
        cost_usd: 1.25,
        input_tokens: 1200,
        cached_input_tokens: 300,
        output_tokens: 450,
        reasoning_tokens: 50,
      },
      by_task: [
        {
          task: "enrich",
          calls: 7,
          input_tokens: 900,
          output_tokens: 250,
          cost_usd: 0.75,
          models: [
            {
              provider: "azure-deepseek",
              model: "DeepSeek-V4-Flash",
              calls: 7,
              cost_usd: 0.75,
            },
          ],
        },
      ],
      by_model: [
        {
          provider: "azure-deepseek",
          model: "DeepSeek-V4-Flash",
          calls: 7,
          cost_usd: 0.75,
        },
      ],
      recent_calls: [
        {
          id: 42,
          task: "enrich",
          provider: "azure-deepseek",
          model: "DeepSeek-V4-Flash",
          input_tokens: 100,
          cached_input_tokens: 25,
          output_tokens: 30,
          reasoning_tokens: 0,
          cost_usd: 0.0123,
          duration_ms: 1500,
          item_id: 99,
          created_at: createdAt.toISOString(),
        },
      ],
    });
  });
});

describe("usage summary request parsing", () => {
  test("defaults requests and MCP inputs to the shared week window", () => {
    const parsed = parseUsageSummaryQueryRequest(
      new Request("https://example.test/api/v1/usage/summary"),
    );

    expect(parsed).toMatchObject({
      ok: true,
      data: { window: "week" },
    });
    expect(usageWindowOrDefault(undefined)).toBe("week");
  });

  test("accepts all-time windows and rejects unknown values before DB work", () => {
    expect(
      parseUsageSummaryQueryRequest(
        new Request("https://example.test/api/v1/usage/summary?window=all"),
      ),
    ).toMatchObject({
      ok: true,
      data: { window: "all" },
    });

    const invalid = parseUsageSummaryQueryRequest(
      new Request("https://example.test/api/v1/usage/summary?window=forever"),
    );
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.issues.length).toBeGreaterThan(0);
  });
});
