import { describe, expect, it } from "bun:test";
import { LLM_MODEL_DEFAULTS } from "@/lib/llm/model-defaults";
import { readSource } from "@/tests/helpers/source";

const envExample = readSource(".env.example");

function envExampleValue(key: string): string | null {
  const line = envExample
    .split("\n")
    .find((candidate) => candidate.startsWith(`${key}=`));
  if (!line) return null;
  return line.slice(key.length + 1);
}

describe("LLM model defaults", () => {
  it("keeps the environment template aligned with runtime defaults", () => {
    expect(envExampleValue("AZURE_OPENAI_CHAT_DEPLOYMENT")).toBe(
      LLM_MODEL_DEFAULTS.azureOpenAIChat,
    );
    expect(envExampleValue("AZURE_OPENAI_EMBEDDING_DEPLOYMENT")).toBe(
      LLM_MODEL_DEFAULTS.embedding,
    );
    expect(envExampleValue("AZURE_DEEPSEEK_DEPLOYMENT")).toBe(
      LLM_MODEL_DEFAULTS.azureDeepSeekPro,
    );
    expect(envExampleValue("AZURE_DEEPSEEK_FLASH_DEPLOYMENT")).toBe(
      LLM_MODEL_DEFAULTS.azureDeepSeekFlash,
    );
    expect(envExampleValue("ANTHROPIC_MODEL")).toBe(
      LLM_MODEL_DEFAULTS.anthropic,
    );
    expect(envExampleValue("GEMINI_MODEL")).toBe(LLM_MODEL_DEFAULTS.gemini);
  });
});
