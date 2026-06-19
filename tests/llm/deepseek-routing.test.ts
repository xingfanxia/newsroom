import { describe, expect, it } from "bun:test";
import {
  zhCommentaryNoteSchema,
  zhCommentarySchema,
  zhEnrichSchema,
  zhScoreRationaleSchema,
} from "@/workers/enrich/chinese";
import {
  isLLMProvider,
  isLLMTask,
  isReasoningEffort,
} from "@/lib/llm/types";
import { readSource } from "@/tests/helpers/source";

const llmSrc = readSource("lib/llm/index.ts");
const modelDefaultsSrc = readSource("lib/llm/model-defaults.ts");
const pricingSrc = readSource("lib/llm/pricing.ts");
const backfillStyleSrc = readSource("scripts/ops/backfill-style.ts");
const typesSrc = readSource("lib/llm/types.ts");
const usageSrc = readSource("lib/llm/usage.ts");

describe("Azure DeepSeek routing", () => {
  it("keeps LLM provider/task/reasoning contracts in runtime tuples", () => {
    expect(typesSrc).toContain("export const LLM_PROVIDERS");
    expect(typesSrc).toContain("export type LLMProvider = (typeof LLM_PROVIDERS)[number]");
    expect(typesSrc).toContain("export const LLM_TASKS");
    expect(typesSrc).toContain("export type LLMTask = (typeof LLM_TASKS)[number]");
    expect(typesSrc).toContain("export const REASONING_EFFORTS");
    expect(typesSrc).toContain(
      "export type ReasoningEffort = (typeof REASONING_EFFORTS)[number]",
    );
    expect(typesSrc).toContain("export function isLLMProvider");
    expect(typesSrc).toContain("export function isLLMTask");
    expect(typesSrc).toContain("export function isReasoningEffort");
    expect(llmSrc).toContain("isLLMProvider");
    expect(llmSrc).toContain("isReasoningEffort");
    expect(usageSrc).toContain("isLLMTask");
    expect(usageSrc).toContain("LLM_TASKS");
    expect(llmSrc).not.toContain("as LLMProvider | undefined");
  });

  it("validates LLM provider, task, and reasoning labels at runtime", () => {
    expect(isLLMProvider("azure-deepseek")).toBe(true);
    expect(isLLMProvider("openai")).toBe(false);
    expect(isLLMTask("event-commentary")).toBe(true);
    expect(isLLMTask("event_commentary")).toBe(false);
    expect(isReasoningEffort("xhigh")).toBe(true);
    expect(isReasoningEffort("maximum")).toBe(false);
  });

  it("registers azure-deepseek as an LLM provider", () => {
    expect(typesSrc).toContain('"azure-deepseek"');
    expect(llmSrc).toContain("AZURE_DEEPSEEK_DEPLOYMENT");
    expect(llmSrc).toContain("AZURE_DEEPSEEK_FLASH_DEPLOYMENT");
    expect(modelDefaultsSrc).toContain('azureDeepSeekPro: "DeepSeek-V4-Pro"');
    expect(modelDefaultsSrc).toContain(
      'azureDeepSeekFlash: "DeepSeek-V4-Flash"',
    );
    expect(llmSrc).toContain("LLM_MODEL_DEFAULTS.azureDeepSeekPro");
    expect(llmSrc).toContain("LLM_MODEL_DEFAULTS.azureDeepSeekFlash");
  });

  it("shares current default model labels across runtime, pricing, and ops scripts", () => {
    expect(modelDefaultsSrc).toContain("export const LLM_MODEL_DEFAULTS");
    expect(llmSrc).toContain('from "./model-defaults"');
    expect(pricingSrc).toContain('from "./model-defaults"');
    expect(backfillStyleSrc).toContain("@/lib/llm/model-defaults");
    expect(pricingSrc).toContain("[LLM_MODEL_DEFAULTS.azureDeepSeekPro]");
    expect(pricingSrc).toContain("[LLM_MODEL_DEFAULTS.azureDeepSeekFlash]");
    expect(pricingSrc).toContain("[LLM_MODEL_DEFAULTS.azureOpenAIChat]");
    expect(pricingSrc).toContain("[LLM_MODEL_DEFAULTS.embedding]");
    expect(backfillStyleSrc).toContain(
      "const MODEL_NAME = LLM_MODEL_DEFAULTS.azureDeepSeekPro",
    );
    for (const literal of [
      '"DeepSeek-V4-Pro"',
      '"DeepSeek-V4-Flash"',
      '"gpt-5.5-standard"',
      '"text-embedding-3-large"',
      '"claude-opus-4-7"',
      '"gemini-3.1-pro-preview"',
    ]) {
      expect(llmSrc).not.toContain(literal);
      expect(typesSrc).not.toContain(literal);
      expect(pricingSrc).not.toContain(literal);
      expect(backfillStyleSrc).not.toContain(literal);
    }
  });

  it("keeps request type comments provider-oriented instead of deployment-specific", () => {
    expect(typesSrc).toContain("azure-openai compatibility deployments");
    expect(typesSrc).toContain("azure-openai-pro deployments");
    expect(typesSrc).toContain("Reasoning-family models reject temperature");
    expect(typesSrc).not.toContain("gpt-5.5-standard: minimal");
    expect(typesSrc).not.toContain("Opus 4.7, Gemini 3 Pro, GPT-5");
  });

  it("accepts a /responses endpoint without double-appending /responses", () => {
    expect(llmSrc).toContain("normalizeOpenAICompatibleBaseURL");
    expect(llmSrc).toContain('replace(/\\/responses$/i, "")');
  });

  it("uses text plus local Zod parsing for DeepSeek structured output", () => {
    expect(llmSrc).toContain('provider === "azure-deepseek"');
    expect(llmSrc).toContain("parseStructuredJson(req.schema, result.text)");
    expect(llmSrc).toContain("deepSeekStructuredInstruction");
    expect(llmSrc).toContain("Your previous response was invalid");
    expect(llmSrc).toContain("requestedDeployment === deepSeekFlashDeployment()");
    expect(llmSrc).toContain("deployment: deepSeekProDeployment()");
  });

  it("routes product text profiles to DeepSeek instead of gpt-5.5", () => {
    expect(llmSrc).toMatch(/enrich:\s*\{[\s\S]*?provider:\s*"azure-deepseek"/);
    expect(llmSrc).toMatch(/score:\s*\{[\s\S]*?provider:\s*"azure-deepseek"/);
    expect(llmSrc).toMatch(/fastText:\s*\{[\s\S]*?provider:\s*"azure-deepseek"/);
    expect(llmSrc).not.toMatch(/enrich:\s*\{[\s\S]*?provider:\s*"azure-openai"/);
    expect(llmSrc).not.toMatch(/score:\s*\{[\s\S]*?provider:\s*"azure-openai"/);
  });

  it("normalizes legacy AZURE_OPENAI_API_VERSION=v1 before embedding calls", () => {
    expect(llmSrc).toContain("normalizeAzureApiVersion");
    expect(llmSrc).toContain('raw === "v1"');
    expect(llmSrc).toContain('"2024-12-01-preview"');
  });

  it("sets a bounded timeout on LLM and embedding provider calls", () => {
    expect(llmSrc).toContain("LLM_CALL_TIMEOUT_MS");
    expect(llmSrc).toContain("llmCallTimeoutMs()");
    expect(llmSrc).toContain("timeout: llmCallTimeoutMs()");
  });
});

describe("Chinese-only schemas", () => {
  it("validates enrichment without English fields", () => {
    const parsed = zhEnrichSchema.parse({
      titleZh: "OpenAI 发布新模型",
      summaryZh: "OpenAI 发布新模型，正文没有披露价格和上下文窗口。",
    });
    expect(parsed.summaryZh).toContain("OpenAI");
  });

  it("validates score rationale without changing score fields", () => {
    const parsed = zhScoreRationaleSchema.parse({
      hkrReasonsZh: {
        h: "模型发布有明确钩子。",
        k: "正文给出模型名称。",
        r: "会触发从业者对路线图的讨论。",
      },
      reasoningZh: "保留现有分层，只重写中文推荐理由。",
    });
    expect(parsed.hkrReasonsZh.h).toContain("模型");
  });

  it("normalizes empty score rationale axes instead of failing the item", () => {
    const parsed = zhScoreRationaleSchema.parse({
      hkrReasonsZh: {
        h: "模型发布有明确钩子。",
        k: "",
        r: "会触发从业者对路线图的讨论。",
      },
      reasoningZh: "保留现有分层，只重写中文推荐理由。",
    });
    expect(parsed.hkrReasonsZh.k).toBe("正文没有给出明确理由。");
  });

  it("truncates overlong Chinese notes for UI safety", () => {
    const parsed = zhCommentaryNoteSchema.parse({
      editorNoteZh: "很".repeat(220),
    });
    expect(parsed.editorNoteZh.length).toBe(200);
  });

  it("validates full Chinese commentary without English fields", () => {
    const parsed = zhCommentarySchema.parse({
      editorNoteZh: "这条更像路线图试探，不是单纯发布。",
      editorAnalysisZh: "OpenAI 把新模型放出来，真正的信息在节奏上：它没有等到完整产品叙事再发布，而是先把开发者注意力拉回来。",
    });
    expect(parsed.editorAnalysisZh).toContain("OpenAI");
  });
});
