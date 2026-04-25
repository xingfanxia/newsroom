import {
  generateText as aiGenerateText,
  generateObject as aiGenerateObject,
  streamText as aiStreamText,
  embed as aiEmbed,
  embedMany as aiEmbedMany,
  type LanguageModel,
} from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAzure } from "@ai-sdk/azure";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import type {
  LLMProvider,
  ReasoningEffort,
  GenerateTextRequest,
  GenerateTextResult,
  GenerateStructuredRequest,
  GenerateStructuredResult,
  EmbedRequest,
  EmbedManyRequest,
  EmbedResult,
  EmbedManyResult,
} from "./types";
import { LLMError } from "./types";
import {
  recordUsage,
  extractCachedTokens,
  extractReasoningTokens,
} from "./usage";

export type {
  LLMProvider,
  ReasoningEffort,
  GenerateTextRequest,
  GenerateTextResult,
  EmbedRequest,
  EmbedManyRequest,
  EmbedResult,
  EmbedManyResult,
} from "./types";
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
  // Embeddings-only (legacy chat-completions deployments still resolve here too,
  // but production chat traffic moved to azureChatClient as of gpt-5.5).
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
  const baseURL = endpoint.replace(/\/+$/, "") + "/openai";
  cachedAzure ??= createAzure({
    apiKey,
    baseURL,
    apiVersion,
    useDeploymentBasedUrls: true,
  });
  return cachedAzure;
}

let cachedAzureChat: ReturnType<typeof createOpenAI> | null = null;
function azureChatClient() {
  // Standard chat lives on the AI Foundry "project" Responses-API endpoint
  // (ax-useast-resource as of gpt-5.5). Same shape as PRO (createOpenAI +
  // baseURL override + api-key header) but a different resource + key.
  const apiKey = process.env.AZURE_OPENAI_CHAT_API_KEY;
  const endpoint = process.env.AZURE_OPENAI_CHAT_ENDPOINT; // ".../openai/v1/"
  if (!apiKey || !endpoint) {
    throw new LLMError(
      "azure-openai",
      "AZURE_OPENAI_CHAT_API_KEY and AZURE_OPENAI_CHAT_ENDPOINT must be set",
    );
  }
  cachedAzureChat ??= createOpenAI({
    apiKey,
    baseURL: endpoint,
    headers: { "api-key": apiKey },
  });
  return cachedAzureChat;
}

let cachedAzurePro: ReturnType<typeof createOpenAI> | null = null;
function azureProClient() {
  // The pro deployment lives on a separate Azure resource and uses Azure's
  // OpenAI-compatible /v1/ endpoint — we access it via @ai-sdk/openai with
  // a baseURL override (identical pattern to the `openai` npm package sample
  // Azure publishes for this deployment).
  const apiKey = process.env.AZURE_OPENAI_PRO_API_KEY;
  const endpoint = process.env.AZURE_OPENAI_PRO_ENDPOINT; // "https://<res>.openai.azure.com/openai/v1/"
  if (!apiKey || !endpoint) {
    throw new LLMError(
      "azure-openai-pro",
      "AZURE_OPENAI_PRO_API_KEY and AZURE_OPENAI_PRO_ENDPOINT must be set",
    );
  }
  cachedAzurePro ??= createOpenAI({
    apiKey,
    baseURL: endpoint,
    // Azure's /v1/ endpoint uses the api-key header, not OpenAI's Bearer token
    headers: { "api-key": apiKey },
  });
  return cachedAzurePro;
}

// ── Model resolvers ─────────────────────────────────────────────

function modelFor(
  provider: LLMProvider,
  opts?: { deployment?: string },
): LanguageModel {
  switch (provider) {
    case "anthropic":
      return anthropicClient()(
        opts?.deployment ??
          process.env.ANTHROPIC_MODEL ??
          "claude-opus-4-7",
      );
    case "gemini":
      return googleClient()(
        opts?.deployment ??
          process.env.GEMINI_MODEL ??
          "gemini-3.1-pro-preview",
      );
    case "azure-openai":
      // gpt-5.5-standard is a Responses-API-only deployment on the AI Foundry
      // project endpoint — no legacy /chat/completions surface, so we route
      // through azureChatClient().responses() instead of azureClient().chat().
      return azureChatClient().responses(
        opts?.deployment ??
          process.env.AZURE_OPENAI_CHAT_DEPLOYMENT ??
          "gpt-5.5-standard",
      );
    case "azure-openai-pro":
      // .responses() uses Azure's new Responses API — reasoning-native,
      // what gpt-5.4-pro is designed for.
      return azureProClient().responses(
        opts?.deployment ??
          process.env.AZURE_OPENAI_PRO_DEPLOYMENT ??
          "gpt-5.4-pro-standard",
      );
    default:
      throw new LLMError(provider, `unknown provider: ${provider}`);
  }
}

function modelId(model: LanguageModel): string {
  return (model as { modelId?: string }).modelId ?? "unknown";
}

function resolveProvider(
  explicit?: LLMProvider,
  envKey:
    | "AIHOT_ENRICH_PROVIDER"
    | "AIHOT_SCORE_PROVIDER"
    | "AIHOT_EMBED_PROVIDER" = "AIHOT_ENRICH_PROVIDER",
): LLMProvider {
  if (explicit) return explicit;
  const env = process.env[envKey] as LLMProvider | undefined;
  return env ?? "anthropic";
}

function reasoningProviderOptions(effort?: ReasoningEffort) {
  if (!effort) return undefined;
  return {
    openai: { reasoningEffort: effort },
  } as const;
}

/**
 * Azure Foundry's Responses-API endpoint (gpt-5.5-standard) rejects requests
 * that pass a top-level `system` field — the AI SDK's `system → instructions`
 * conversion produces an input item with empty `type`, and the API responds
 * with `Invalid value: ''. Supported values are: 'message', 'reasoning', ...`.
 *
 * Workaround: fold the system prompt into the first user message as a prefix.
 * Every other provider continues to receive `system` as a discrete role.
 */
type ChatLike = {
  system?: string;
  messages: Array<{ role: string; content: unknown }>;
};
function applyAzureFoundryWorkaround<T extends ChatLike>(
  provider: LLMProvider,
  req: T,
): T {
  if (provider !== "azure-openai" || !req.system) return req;
  const merged = `${req.system}\n\n---\n\n`;
  const [first, ...rest] = req.messages;
  const firstContent = typeof first?.content === "string" ? first.content : "";
  const newFirst =
    first && first.role === "user"
      ? { ...first, content: merged + firstContent }
      : { role: "user" as const, content: merged };
  const newMessages =
    first && first.role === "user"
      ? [newFirst, ...rest]
      : [newFirst, ...req.messages];
  return { ...req, system: undefined, messages: newMessages } as T;
}

// ── Public API ──────────────────────────────────────────────────

export async function generateText(
  req: GenerateTextRequest,
): Promise<GenerateTextResult> {
  const provider = resolveProvider(req.provider);
  const model = modelFor(provider, { deployment: req.deployment });
  const adjusted = applyAzureFoundryWorkaround(provider, req);
  const started = Date.now();
  try {
    const result = await aiGenerateText({
      model,
      system: adjusted.system,
      messages: adjusted.messages,
      maxOutputTokens: req.maxTokens ?? 2048,
      providerOptions: reasoningProviderOptions(req.reasoningEffort),
      ...(req.temperature !== undefined
        ? { temperature: req.temperature }
        : {}),
    });
    recordUsage({
      provider,
      model: modelId(model),
      task: req.task,
      itemId: req.itemId,
      tokens: {
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
        cachedInputTokens: extractCachedTokens(result.providerMetadata),
        reasoningTokens: extractReasoningTokens(result.providerMetadata),
      },
      durationMs: Date.now() - started,
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
  const model = modelFor(provider, { deployment: req.deployment });
  const adjusted = applyAzureFoundryWorkaround(provider, req);
  const started = Date.now();
  try {
    const result = await aiGenerateObject({
      model,
      system: adjusted.system,
      messages: adjusted.messages,
      schema: req.schema,
      schemaName: req.schemaName,
      schemaDescription: req.schemaDescription,
      maxOutputTokens: req.maxTokens ?? 2048,
      providerOptions: reasoningProviderOptions(req.reasoningEffort),
      ...(req.temperature !== undefined
        ? { temperature: req.temperature }
        : {}),
    });
    recordUsage({
      provider,
      model: modelId(model),
      task: req.task,
      itemId: req.itemId,
      tokens: {
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
        cachedInputTokens: extractCachedTokens(result.providerMetadata),
        reasoningTokens: extractReasoningTokens(result.providerMetadata),
      },
      durationMs: Date.now() - started,
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
  const model = modelFor(provider, { deployment: req.deployment });
  const adjusted = applyAzureFoundryWorkaround(provider, req);
  return aiStreamText({
    model,
    system: adjusted.system,
    messages: adjusted.messages,
    maxOutputTokens: req.maxTokens ?? 2048,
    providerOptions: reasoningProviderOptions(req.reasoningEffort),
    ...(req.temperature !== undefined
      ? { temperature: req.temperature }
      : {}),
  });
}

// ── Embeddings ──────────────────────────────────────────────────

function embeddingModelFor(provider: LLMProvider) {
  if (provider !== "azure-openai") {
    throw new LLMError(
      provider,
      `embedding not implemented for provider ${provider}`,
    );
  }
  const deployment = process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT;
  if (!deployment) {
    throw new LLMError(
      "azure-openai",
      "AZURE_OPENAI_EMBEDDING_DEPLOYMENT is not set",
    );
  }
  return azureClient().textEmbeddingModel(deployment);
}

export async function embed(req: EmbedRequest): Promise<EmbedResult> {
  const provider = resolveProvider(req.provider, "AIHOT_EMBED_PROVIDER");
  const model = embeddingModelFor(provider);
  const started = Date.now();
  try {
    const result = await aiEmbed({ model, value: req.value });
    const resolvedModel = modelId(model as unknown as LanguageModel);
    recordUsage({
      provider,
      model: resolvedModel,
      task: req.task ?? "embed",
      itemId: req.itemId,
      tokens: { inputTokens: result.usage?.tokens, outputTokens: 0 },
      durationMs: Date.now() - started,
    });
    return {
      embedding: result.embedding,
      provider,
      model: resolvedModel,
      tokens: result.usage?.tokens,
    };
  } catch (err) {
    throw new LLMError(
      provider,
      err instanceof Error ? err.message : String(err),
      err,
    );
  }
}

export async function embedMany(
  req: EmbedManyRequest,
): Promise<EmbedManyResult> {
  const provider = resolveProvider(req.provider, "AIHOT_EMBED_PROVIDER");
  const model = embeddingModelFor(provider);
  const started = Date.now();
  try {
    const result = await aiEmbedMany({ model, values: req.values });
    const resolvedModel = modelId(model as unknown as LanguageModel);
    recordUsage({
      provider,
      model: resolvedModel,
      task: req.task ?? "embed",
      itemId: req.itemId,
      tokens: { inputTokens: result.usage?.tokens, outputTokens: 0 },
      durationMs: Date.now() - started,
    });
    return {
      embeddings: result.embeddings,
      provider,
      model: resolvedModel,
      tokens: result.usage?.tokens,
    };
  } catch (err) {
    throw new LLMError(
      provider,
      err instanceof Error ? err.message : String(err),
      err,
    );
  }
}

// ── Task profiles ───────────────────────────────────────────────
// Opinionated per-task model + reasoning presets — callers use these
// instead of hand-wiring provider+deployment+effort each time.

export const profiles = {
  /** Deterministic summarization / tagging. Cheap + fast. */
  enrich: {
    provider: "azure-openai" as const,
    reasoningEffort: "low" as const,
  },
  /** Editorial scoring. Reasoning-grade quality without pro's latency —
   *  standard + high is ~3x faster than pro + medium at ~95% of the quality
   *  on deterministic rubric tasks. */
  score: {
    provider: "azure-openai" as const,
    reasoningEffort: "high" as const,
  },
  /** M4 policy-iteration agent. Deepest reasoning. */
  agent: {
    provider: "azure-openai-pro" as const,
    reasoningEffort: "xhigh" as const,
  },
} satisfies Record<
  string,
  { provider: LLMProvider; reasoningEffort: ReasoningEffort }
>;

// ── Diagnostics ─────────────────────────────────────────────────

export function availableProviders(): LLMProvider[] {
  const out: LLMProvider[] = [];
  if (process.env.ANTHROPIC_API_KEY) out.push("anthropic");
  if (process.env.GEMINI_API_KEY) out.push("gemini");
  // azure-openai requires both: chat creds (gpt-5.5 Responses API) AND
  // legacy creds (embeddings via createAzure). Either missing → no provider.
  if (
    process.env.AZURE_OPENAI_CHAT_API_KEY &&
    process.env.AZURE_OPENAI_CHAT_ENDPOINT &&
    process.env.AZURE_OPENAI_API_KEY &&
    process.env.AZURE_OPENAI_ENDPOINT
  ) {
    out.push("azure-openai");
  }
  if (
    process.env.AZURE_OPENAI_PRO_API_KEY &&
    process.env.AZURE_OPENAI_PRO_ENDPOINT
  ) {
    out.push("azure-openai-pro");
  }
  return out;
}
