import {
  generateText as aiGenerateText,
  generateObject as aiGenerateObject,
  streamText as aiStreamText,
  type LanguageModel,
} from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAzure } from "@ai-sdk/azure";
import { z } from "zod";
import type {
  LLMProvider,
  GenerateTextRequest,
  GenerateTextResult,
  GenerateStructuredRequest,
  GenerateStructuredResult,
} from "./types";
import { LLMError } from "./types";

export type { LLMProvider, GenerateTextRequest, GenerateTextResult } from "./types";
export { LLMError } from "./types";

// ── Provider clients (lazy, singleton per provider) ─────────────

let cachedAnthropic: ReturnType<typeof createAnthropic> | null = null;
function anthropicClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new LLMError("anthropic", "ANTHROPIC_API_KEY is not set");
  }
  cachedAnthropic ??= createAnthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });
  return cachedAnthropic;
}

let cachedGoogle: ReturnType<typeof createGoogleGenerativeAI> | null = null;
function googleClient() {
  if (!process.env.GEMINI_API_KEY) {
    throw new LLMError("gemini", "GEMINI_API_KEY is not set");
  }
  cachedGoogle ??= createGoogleGenerativeAI({
    apiKey: process.env.GEMINI_API_KEY,
  });
  return cachedGoogle;
}

let cachedAzure: ReturnType<typeof createAzure> | null = null;
function azureClient() {
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiVersion =
    process.env.AZURE_OPENAI_API_VERSION ?? "2024-12-01-preview";
  if (!apiKey || !endpoint) {
    throw new LLMError(
      "azure-openai",
      "AZURE_OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT must be set",
    );
  }
  // Our endpoint is the Azure AI Foundry / Cognitive Services multi-service URL
  // (e.g. https://<res>.cognitiveservices.azure.com/), NOT the legacy
  // <res>.openai.azure.com domain that @ai-sdk/azure defaults to. Override
  // via `baseURL` which takes precedence over `resourceName`.
  //
  // useDeploymentBasedUrls: true forces the /openai/deployments/<name>/chat/completions
  // path (with api-version as query), which is what our GPT-5 deployment accepts.
  // Without it, the SDK defaults to the newer /responses API that our deployment
  // does not yet support.
  const baseURL = endpoint.replace(/\/+$/, "") + "/openai";
  cachedAzure ??= createAzure({
    apiKey,
    baseURL,
    apiVersion,
    useDeploymentBasedUrls: true,
    fetch: (url, init) => {
      if (process.env.AIHOT_LLM_DEBUG) console.log("[azure] →", url);
      return fetch(url, init);
    },
  });
  return cachedAzure;
}

// ── Model resolvers ─────────────────────────────────────────────

function modelFor(provider: LLMProvider): LanguageModel {
  switch (provider) {
    case "anthropic":
      return anthropicClient()(
        process.env.ANTHROPIC_MODEL ?? "claude-opus-4-7",
      );
    case "gemini":
      return googleClient()(
        process.env.GEMINI_MODEL ?? "gemini-3.1-pro-preview",
      );
    case "azure-openai":
      // .chat() forces the /chat/completions endpoint that our GPT-5
      // deployment supports; default .responses() API is not yet available.
      return azureClient().chat(
        process.env.AZURE_OPENAI_DEPLOYMENT ?? "gpt-5.4-standard",
      );
    default:
      throw new LLMError(provider, `unknown provider: ${provider}`);
  }
}

function modelId(model: LanguageModel): string {
  // LanguageModel exposes modelId at runtime on each provider's impl
  return (model as { modelId?: string }).modelId ?? "unknown";
}

function resolveProvider(explicit?: LLMProvider): LLMProvider {
  if (explicit) return explicit;
  const env = process.env.AIHOT_ENRICH_PROVIDER as LLMProvider | undefined;
  return env ?? "anthropic";
}

// ── Public API ──────────────────────────────────────────────────

export async function generateText(
  req: GenerateTextRequest,
): Promise<GenerateTextResult> {
  const provider = resolveProvider(req.provider);
  const model = modelFor(provider);
  try {
    const result = await aiGenerateText({
      model,
      system: req.system,
      messages: req.messages,
      maxOutputTokens: req.maxTokens ?? 2048,
      // Reasoning-family models (Opus 4.7, GPT-5, Gemini 3 Pro) don't accept
      // temperature — only pass it if the caller explicitly opts in.
      ...(req.temperature !== undefined
        ? { temperature: req.temperature }
        : {}),
    });
    return {
      text: result.text,
      provider,
      model: modelId(model),
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
      reasoningText: result.reasoningText ?? undefined,
    };
  } catch (err) {
    throw new LLMError(
      provider,
      err instanceof Error ? err.message : String(err),
      err,
    );
  }
}

export async function generateStructured<T extends z.ZodTypeAny>(
  req: GenerateStructuredRequest<T>,
): Promise<GenerateStructuredResult<T>> {
  const provider = resolveProvider(req.provider);
  const model = modelFor(provider);
  try {
    const result = await aiGenerateObject({
      model,
      system: req.system,
      messages: req.messages,
      schema: req.schema,
      schemaName: req.schemaName,
      schemaDescription: req.schemaDescription,
      maxOutputTokens: req.maxTokens ?? 2048,
      ...(req.temperature !== undefined
        ? { temperature: req.temperature }
        : {}),
    });
    return {
      data: result.object as z.infer<T>,
      provider,
      model: modelId(model),
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
    };
  } catch (err) {
    throw new LLMError(
      provider,
      err instanceof Error ? err.message : String(err),
      err,
    );
  }
}

export function streamText(req: GenerateTextRequest) {
  const provider = resolveProvider(req.provider);
  const model = modelFor(provider);
  return aiStreamText({
    model,
    system: req.system,
    messages: req.messages,
    maxOutputTokens: req.maxTokens ?? 2048,
    ...(req.temperature !== undefined
      ? { temperature: req.temperature }
      : {}),
  });
}

// ── Diagnostics ─────────────────────────────────────────────────

export function availableProviders(): LLMProvider[] {
  const out: LLMProvider[] = [];
  if (process.env.ANTHROPIC_API_KEY) out.push("anthropic");
  if (process.env.GEMINI_API_KEY) out.push("gemini");
  if (process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_ENDPOINT) {
    out.push("azure-openai");
  }
  return out;
}
