import { describe, expect, it } from "bun:test";
import { runColumnSelfCheck } from "./self-check";

describe("runColumnSelfCheck", () => {
  it("passes a clean draft", () => {
    const result = runColumnSelfCheck({
      title: "今天 AI 圈又不太平",
      summary_md:
        "1. OpenAI 发了 GPT-5.5，确实是个跳跃。说实话我对参数效率印象更深。 [#101]",
      narrative_md:
        "我跟你说，今天最有意思的不是 5.5 这个数字。\n\n而是它的训练成本。。。\n\n回到这块，愚钝如我没完全看明白他们的论文。",
    });
    expect(result.l1Pass).toBe(true);
    expect(result.l2Pass).toBe(true);
    expect(result.hits).toEqual([]);
  });

  it("flags L1 banned phrases", () => {
    const result = runColumnSelfCheck({
      title: "AI 行业",
      summary_md: "1. X 发了产品 [#1]",
      narrative_md: "说白了，这个本质上就是换皮。综上所述这没意思。",
    });
    expect(result.l1Pass).toBe(false);
    const rules = result.hits
      .filter((h) => h.layer === "l1")
      .map((h) => h.rule);
    expect(rules).toContain("说白了");
    expect(rules).toContain("本质上");
    expect(rules).toContain("综上所述");
  });

  it("flags L2 banned punctuation in narrative", () => {
    const result = runColumnSelfCheck({
      title: "今日 AI",
      summary_md: "1. X [#1]",
      narrative_md: '这件事："我觉得很重要"——但其实没那么严重。',
    });
    expect(result.l2Pass).toBe(false);
    const rules = result.hits
      .filter((h) => h.layer === "l2")
      .map((h) => h.rule);
    expect(rules).toContain("冒号");
    expect(rules).toContain("破折号");
    expect(rules).toContain("双引号");
  });

  it("does NOT flag colons in summary numbered list (allowed exception)", () => {
    const result = runColumnSelfCheck({
      title: "今日 AI",
      summary_md: "1. OpenAI 发布 GPT-5.5: 确实有意思 [#1]",
      narrative_md: "说真的我觉得这个挺好的。",
    });
    expect(result.l2Pass).toBe(true);
  });

  it("captures snippet context around hits", () => {
    const result = runColumnSelfCheck({
      title: "title",
      summary_md: "1. x [#1]",
      narrative_md: "前面的话，说白了它就是这样的，后面的话",
    });
    const hit = result.hits.find((h) => h.rule === "说白了");
    expect(hit?.snippet).toContain("说白了");
    expect(hit?.snippet.length).toBeLessThanOrEqual(50);
  });
});
