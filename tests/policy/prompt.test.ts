import { describe, expect, it } from "bun:test";
import {
  agentUserPrompt,
  iterationProposalSchema,
  MIN_FEEDBACK_TO_ITERATE,
} from "@/workers/agent/prompt";

describe("agent prompt", () => {
  it("formats feedback into indexed blocks with trimmed notes", () => {
    const out = agentUserPrompt({
      currentContent: "# skill",
      feedback: [
        {
          verdict: "up",
          title: "Claude 4.7",
          note: "  很重要的 release  ",
          createdAt: "2026-04-17T10:00:00Z",
        },
        {
          verdict: "down",
          title: "CVE 逆向",
          note: "",
          createdAt: "2026-04-17T11:00:00Z",
        },
      ],
    });
    expect(out).toContain("[1] UP @ 2026-04-17T10:00:00Z");
    expect(out).toContain("备注：很重要的 release");
    expect(out).toContain("[2] DOWN @ 2026-04-17T11:00:00Z");
    expect(out).toContain("备注：(no note)");
  });

  it("embeds count + today ISO date for heuristic-append rule", () => {
    const today = new Date().toISOString().slice(0, 10);
    const out = agentUserPrompt({
      currentContent: "# skill",
      feedback: Array.from({ length: 6 }, (_, i) => ({
        verdict: "up" as const,
        title: `t${i}`,
        note: "",
        createdAt: "2026-04-17T10:00:00Z",
      })),
    });
    expect(out).toContain(`count="6"`);
    expect(out).toContain(`today="${today}"`);
  });

  it("warns agent about MIN_FEEDBACK_TO_ITERATE threshold", () => {
    const out = agentUserPrompt({ currentContent: "# skill", feedback: [] });
    expect(out).toContain(`< ${MIN_FEEDBACK_TO_ITERATE}`);
    expect(out).toContain("(no feedback rows — you MUST refuse)");
  });
});

describe("iterationProposalSchema", () => {
  it("accepts a well-formed proposal", () => {
    const parsed = iterationProposalSchema.safeParse({
      reasoningSummary:
        "观察到连续下投的是技术深度过高的条目（CVE 逆向、理论物理）以及云厂商广告稿。已把前者抽象为'技术可及性失败'的硬排除规则，后者加入'纯营销内容'条目。国内厂商（小米/百度/阿里）新模型应与美厂平权评分，这点之前策略没明确。本次修改保守：只动了硬排除与加分项，没有碰 HKR 与评分档的阈值数字。",
      changeSummary: "1. 新增一条硬排除：技术可及性失败。\n2. 音频分类未触碰。",
      didNotChange: [
        {
          item: "把 CVE 类型单独列为硬排除",
          reason: "特殊案例会导致过拟合，应使用更抽象的模式",
        },
      ],
      proposedContent: "# editorial.skill.md\n".padEnd(2200, "x"),
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an empty didNotChange array", () => {
    const parsed = iterationProposalSchema.safeParse({
      reasoningSummary: "x".repeat(120),
      changeSummary: "1. foo",
      didNotChange: [],
      proposedContent: "y".repeat(2100),
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an under-length proposedContent", () => {
    const parsed = iterationProposalSchema.safeParse({
      reasoningSummary: "x".repeat(120),
      changeSummary: "1. foo",
      didNotChange: [
        { item: "hold back X", reason: "needs more signal to codify" },
      ],
      proposedContent: "too short",
    });
    expect(parsed.success).toBe(false);
  });
});
