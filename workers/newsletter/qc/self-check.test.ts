import { describe, expect, it } from "bun:test";
import { runColumnSelfCheck } from "./self-check";

describe("runColumnSelfCheck", () => {
  it("passes a clean draft with normal punctuation", () => {
    const result = runColumnSelfCheck({
      title: "OpenAI 把 GPT-5.5 接进 API",
      summary_md:
        "1. OpenAI 发布 GPT-5.5: 确实是个跳跃。我的判断是这次主要是工程优化。 [#101]",
      narrative_md:
        "我的判断是, 今天最有意思的不是 5.5 这个数字。而是它的训练成本——公开信息没披露具体数字, 但可以从云合同的尺寸推断。",
    });
    expect(result.l1Pass).toBe(true);
    expect(result.l2Pass).toBe(true);
    expect(result.hits).toEqual([]);
  });

  it("flags L1 banned phrases (corporate AI-slop)", () => {
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

  it("L2 always passes (punctuation rules dropped after voice rebase)", () => {
    const result = runColumnSelfCheck({
      title: "今日 AI: 一个判断",
      summary_md: "1. X [#1]",
      narrative_md:
        '这件事的关键在于："谁来买单" — 答案不在产品页, 而在合同条款里。',
    });
    // colons, em-dashes, double quotes are all OK now
    expect(result.l2Pass).toBe(true);
  });

  it("captures snippet context around L1 hits", () => {
    const result = runColumnSelfCheck({
      title: "title",
      summary_md: "1. x [#1]",
      narrative_md: "前面的话，说白了它就是这样的，后面的话",
    });
    const hit = result.hits.find((h) => h.rule === "说白了");
    expect(hit?.snippet).toContain("说白了");
    expect(hit?.snippet.length).toBeLessThanOrEqual(50);
  });

  it("does not flag '首先 / 其次 / 最后' anymore (was khazix-only constraint)", () => {
    const result = runColumnSelfCheck({
      title: "title",
      summary_md: "1. x [#1]",
      narrative_md:
        "先看 X 怎么走, 再看 Y 怎么响应, 最后值得跟进的是 Z 的回应。",
    });
    expect(result.l1Pass).toBe(true);
  });
});
