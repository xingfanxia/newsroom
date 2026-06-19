import { describe, expect, it } from "bun:test";
import {
  HIGH_VALUE_IMPORTANCE_THRESHOLD,
  treatmentForScore,
} from "@/workers/enrich/treatment";
import { readSource } from "@/tests/helpers/source";

describe("enrich model treatment", () => {
  it("routes low-importance items to the fast treatment", () => {
    expect(treatmentForScore({ importance: 35, tier: "excluded" })).toBe(
      "fast",
    );
    expect(treatmentForScore({ importance: 60, tier: "all" })).toBe("fast");
  });

  it("routes high-importance items to the high-quality treatment", () => {
    expect(HIGH_VALUE_IMPORTANCE_THRESHOLD).toBe(72);
    expect(treatmentForScore({ importance: 72, tier: "all" })).toBe("high");
    expect(treatmentForScore({ importance: 90, tier: "featured" })).toBe(
      "high",
    );
    expect(treatmentForScore({ importance: 90, tier: "p1" })).toBe("high");
  });

  it("wires DeepSeek V4 Flash as the low-value deployment", () => {
    const llmSrc = readSource("lib/llm/index.ts");
    const modelDefaultsSrc = readSource("lib/llm/model-defaults.ts");
    expect(llmSrc).toContain("AZURE_DEEPSEEK_FLASH_DEPLOYMENT");
    expect(modelDefaultsSrc).toContain(
      'azureDeepSeekFlash: "DeepSeek-V4-Flash"',
    );
    expect(llmSrc).toContain("LLM_MODEL_DEFAULTS.azureDeepSeekFlash");
    expect(llmSrc).toContain("fastText");
  });

  it("uses DeepSeek V4 Pro, not gpt-5.5, for high-value text generation", () => {
    const llmSrc = readSource("lib/llm/index.ts");
    const modelDefaultsSrc = readSource("lib/llm/model-defaults.ts");
    expect(llmSrc).toContain("deployment: deepSeekProDeployment()");
    expect(modelDefaultsSrc).toContain('azureDeepSeekPro: "DeepSeek-V4-Pro"');
    expect(llmSrc).toContain("LLM_MODEL_DEFAULTS.azureDeepSeekPro");
    expect(llmSrc).not.toMatch(/enrich:\s*\{[\s\S]*?provider:\s*"azure-openai"/);
    expect(llmSrc).not.toMatch(/score:\s*\{[\s\S]*?provider:\s*"azure-openai"/);
  });

  it("live enrich starts cheap, then upgrades only high-value items", () => {
    const src = readSource("workers/enrich/index.ts");
    expect(src).toContain("profiles.fastText");
    expect(src).toContain("treatmentForScore");
    expect(src).toContain("regenerateHighValueItem");
  });
});
