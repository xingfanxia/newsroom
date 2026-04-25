import { describe, expect, it, beforeEach } from "vitest";
import {
  loadDailyColumnPrompt,
  __resetDailyColumnPromptCache,
} from "@/lib/llm/prompts/load";

describe("loadDailyColumnPrompt", () => {
  beforeEach(() => __resetDailyColumnPromptCache());

  it("returns the daily-column.md content as a single string", () => {
    const prompt = loadDailyColumnPrompt();
    expect(prompt).toMatch(/卡兹克/);
    expect(prompt).toMatch(/UNTRUSTED CONTENT NOTICE/);
    expect(prompt.length).toBeGreaterThan(1500);
  });

  it("memoizes after first load", () => {
    const a = loadDailyColumnPrompt();
    const b = loadDailyColumnPrompt();
    expect(a).toBe(b);
  });

  it("includes the output schema block", () => {
    const prompt = loadDailyColumnPrompt();
    expect(prompt).toMatch(/title: string/);
    expect(prompt).toMatch(/summary_md: string/);
    expect(prompt).toMatch(/narrative_md: string/);
    expect(prompt).toMatch(/featured_item_ids: int\[\]/);
  });
});
