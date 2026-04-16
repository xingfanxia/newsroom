import { z } from "zod";
import type {
  LLMProvider,
  GenerateTextOptions,
  GenerateStructuredOptions,
  GenerateTextResult,
  GenerateStructuredResult,
} from "./types";
import { LLMError } from "./types";
import { anthropicGenerate, anthropicStructured } from "./anthropic";
import { geminiGenerate, geminiStructured } from "./gemini";
import { azureOpenAIGenerate, azureOpenAIStructured } from "./azure-openai";

export type { LLMProvider, GenerateTextOptions, GenerateTextResult } from "./types";
export { LLMError } from "./types";

function resolveProvider(explicit?: LLMProvider): LLMProvider {
  if (explicit) return explicit;
  const env = process.env.AIHOT_ENRICH_PROVIDER as LLMProvider | undefined;
  return env ?? "anthropic";
}

export async function generateText(
  opts: GenerateTextOptions,
): Promise<GenerateTextResult> {
  const provider = resolveProvider(opts.provider);
  switch (provider) {
    case "anthropic":
      return anthropicGenerate(opts);
    case "gemini":
      return geminiGenerate(opts);
    case "azure-openai":
      return azureOpenAIGenerate(opts);
    default:
      throw new LLMError(provider, `unknown provider: ${provider}`);
  }
}

export async function generateStructured<T extends z.ZodTypeAny>(
  opts: GenerateStructuredOptions<T>,
): Promise<GenerateStructuredResult<T>> {
  const provider = resolveProvider(opts.provider);
  switch (provider) {
    case "anthropic":
      return anthropicStructured(opts);
    case "gemini":
      return geminiStructured(opts);
    case "azure-openai":
      return azureOpenAIStructured(opts);
    default:
      throw new LLMError(provider, `unknown provider: ${provider}`);
  }
}

// ───────── Convenience presets ─────────

export function availableProviders(): LLMProvider[] {
  const out: LLMProvider[] = [];
  if (process.env.ANTHROPIC_API_KEY) out.push("anthropic");
  if (process.env.GEMINI_API_KEY) out.push("gemini");
  if (
    process.env.AZURE_OPENAI_API_KEY &&
    process.env.AZURE_OPENAI_ENDPOINT &&
    process.env.AZURE_OPENAI_DEPLOYMENT
  ) {
    out.push("azure-openai");
  }
  return out;
}
