import { describe, expect, test } from "bun:test";
import { USAGE_WINDOWS } from "@/lib/llm/stats";
import { LLM_TASKS } from "@/lib/llm/types";
import {
  USAGE_RANGE_LABELS,
  USAGE_TASK_TONES,
  formatUsageCount,
  formatUsageShortDate,
  formatUsageTaskModels,
  formatUsageTokens,
  usageRangeLabel,
  usageTaskTone,
} from "@/lib/llm/usage-display";

describe("usage display contract", () => {
  test("range labels are exhaustive over the runtime usage window tuple", () => {
    expect(Object.keys(USAGE_RANGE_LABELS)).toEqual([...USAGE_WINDOWS]);
    expect(usageRangeLabel("today", "en")).toBe("today");
    expect(usageRangeLabel("today", "zh")).toBe("今日");
    expect(usageRangeLabel("all", "en")).toBe("all-time");
    expect(usageRangeLabel("all", "zh")).toBe("全量");
  });

  test("task tones are exhaustive over the runtime LLM task tuple", () => {
    expect(Object.keys(USAGE_TASK_TONES)).toEqual([...LLM_TASKS]);
    expect(usageTaskTone("score")).toBe("g");
    expect(usageTaskTone("enrich")).toBe("b");
    expect(usageTaskTone("commentary")).toBe("o");
    expect(usageTaskTone("event-commentary")).toBe("o");
    expect(usageTaskTone("agent")).toBe("r");
    expect(usageTaskTone("unknown-task")).toBe("");
    expect(usageTaskTone(null)).toBe("");
  });

  test("formats numeric usage labels consistently", () => {
    expect(formatUsageTokens(999)).toBe("999");
    expect(formatUsageTokens(12_340)).toBe("12.3K");
    expect(formatUsageTokens(1_234_000)).toBe("1.23M");
    expect(formatUsageCount(999)).toBe("999");
    expect(formatUsageCount(12_340)).toBe("12.3K");
    expect(formatUsageCount(1_234_000)).toBe("1.23M");
  });

  test("formats task model summaries with a stable top-two cap", () => {
    expect(formatUsageTaskModels([])).toBe("—");
    expect(
      formatUsageTaskModels([
        { provider: "azure-deepseek", model: "DeepSeek-V4-Pro", calls: 2210 },
        { provider: "azure-deepseek", model: "DeepSeek-V4-Flash", calls: 41 },
        { provider: "anthropic", model: "claude-haiku-4-5", calls: 7 },
      ]),
    ).toBe("DeepSeek-V4-Pro 2.2K · DeepSeek-V4-Flash 41");
  });

  test("formats short dates for the sparkline axis", () => {
    expect(formatUsageShortDate("2026-06-13")).toBe("06·13");
  });
});
