import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import {
  zhCommentaryNoteSchema,
  zhCommentarySchema,
  zhEnrichSchema,
  zhScoreRationaleSchema,
} from "@/workers/enrich/chinese";

const __dirname = dirname(fileURLToPath(import.meta.url));
const llmSrc = readFileSync(resolve(__dirname, "../../lib/llm/index.ts"), "utf8");
const typesSrc = readFileSync(resolve(__dirname, "../../lib/llm/types.ts"), "utf8");

describe("Azure DeepSeek routing", () => {
  it("registers azure-deepseek as an LLM provider", () => {
    expect(typesSrc).toContain('"azure-deepseek"');
    expect(llmSrc).toContain("AZURE_DEEPSEEK_DEPLOYMENT");
    expect(llmSrc).toContain("AZURE_DEEPSEEK_FLASH_DEPLOYMENT");
    expect(llmSrc).toContain("DeepSeek-V4-Pro");
    expect(llmSrc).toContain("DeepSeek-V4-Flash");
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
