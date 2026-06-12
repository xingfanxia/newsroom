import {
  generateText as aiGenerateText,
  generateObject as aiGenerateObject,
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

const DEFAULT_LLM_CALL_TIMEOUT_MS = 90_000;

function llmCallTimeoutMs(): number {
  const raw = Number(process.env.LLM_CALL_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_LLM_CALL_TIMEOUT_MS;
}

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
function normalizeAzureApiVersion(raw: string | undefined): string {
  if (!raw || raw === "v1") return "2024-12-01-preview";
  return raw;
}

function azureClient() {
  // Embeddings-only (legacy chat-completions deployments still resolve here too,
  // but production chat traffic moved to azureChatClient as of gpt-5.5).
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiVersion = normalizeAzureApiVersion(
    process.env.AZURE_OPENAI_API_VERSION,
  );
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
function normalizeOpenAICompatibleBaseURL(endpoint: string): string {
  return endpoint.replace(/\/+$/, "").replace(/\/responses$/i, "");
}

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
    baseURL: normalizeOpenAICompatibleBaseURL(endpoint),
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

let cachedAzureDeepSeek: ReturnType<typeof createOpenAI> | null = null;
function azureDeepSeekClient() {
  const apiKey = process.env.AZURE_DEEPSEEK_API_KEY;
  const endpoint = process.env.AZURE_DEEPSEEK_ENDPOINT;
  if (!apiKey || !endpoint) {
    throw new LLMError(
      "azure-deepseek",
      "AZURE_DEEPSEEK_API_KEY and AZURE_DEEPSEEK_ENDPOINT must be set",
    );
  }
  cachedAzureDeepSeek ??= createOpenAI({
    apiKey,
    baseURL: normalizeOpenAICompatibleBaseURL(endpoint),
    headers: { "api-key": apiKey },
  });
  return cachedAzureDeepSeek;
}

function deepSeekProDeployment(): string {
  return process.env.AZURE_DEEPSEEK_DEPLOYMENT ?? "DeepSeek-V4-Pro";
}

function deepSeekFlashDeployment(): string {
  return process.env.AZURE_DEEPSEEK_FLASH_DEPLOYMENT ?? "DeepSeek-V4-Flash";
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
      // .responses() uses Azure's Responses API for the optional agent profile.
      {
        const deployment = opts?.deployment ?? process.env.AZURE_OPENAI_PRO_DEPLOYMENT;
        if (!deployment) {
          throw new LLMError(
            "azure-openai-pro",
            "AZURE_OPENAI_PRO_DEPLOYMENT must be set",
          );
        }
        return azureProClient().responses(deployment);
      }
    case "azure-deepseek":
      return azureDeepSeekClient().responses(
        opts?.deployment ?? deepSeekProDeployment(),
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

function reasoningProviderOptions(provider: LLMProvider, effort?: ReasoningEffort) {
  if (!effort) return undefined;
  if (provider === "azure-deepseek") return undefined;
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
  if (
    (provider !== "azure-openai" && provider !== "azure-deepseek") ||
    !req.system
  ) {
    return req;
  }
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

function parseJsonObject(text: string): unknown {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(stripped.slice(start, end + 1));
    }
    throw new Error("could not parse JSON object from model response");
  }
}

type JsonSchemaObject = {
  type?: string | string[];
  properties?: Record<string, JsonSchemaObject>;
  items?: JsonSchemaObject;
  enum?: unknown[];
  anyOf?: JsonSchemaObject[];
  oneOf?: JsonSchemaObject[];
  $ref?: string;
};

function schemaExample(schema: z.ZodTypeAny): string {
  try {
    const jsonSchema = z.toJSONSchema(schema, {
      io: "input",
    }) as JsonSchemaObject;
    return JSON.stringify(exampleFromJsonSchema(jsonSchema), null, 2);
  } catch {
    return "{}";
  }
}

function exampleFromJsonSchema(schema: JsonSchemaObject): unknown {
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (schema.enum && schema.enum.length > 0) return schema.enum[0];
  if (schema.anyOf?.length) return exampleFromJsonSchema(schema.anyOf[0]!);
  if (schema.oneOf?.length) return exampleFromJsonSchema(schema.oneOf[0]!);
  if (type === "object" || schema.properties) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      out[key] = exampleFromJsonSchema(child);
    }
    return out;
  }
  if (type === "array") return [];
  if (type === "number" || type === "integer") return 0;
  if (type === "boolean") return false;
  return "";
}

function normalizeForJsonSchema(
  value: unknown,
  schema: JsonSchemaObject,
): unknown {
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (schema.anyOf?.length) return normalizeForJsonSchema(value, schema.anyOf[0]!);
  if (schema.oneOf?.length) return normalizeForJsonSchema(value, schema.oneOf[0]!);
  if (type === "object" || schema.properties) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const input = value as Record<string, unknown>;
    const out: Record<string, unknown> = { ...input };
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (key in input) {
        out[key] = normalizeForJsonSchema(input[key], child);
      }
    }
    return out;
  }
  if (type === "array") {
    return Array.isArray(value) ? value : value == null ? value : [value];
  }
  if (type === "string") {
    return coerceStringValue(value);
  }
  return value;
}

function coerceStringValue(value: unknown): unknown {
  if (typeof value === "string") return value;
  if (value == null) return value;
  if (Array.isArray(value)) {
    const strings = value.filter((v): v is string => typeof v === "string");
    return strings.length > 0 ? strings.join("\n") : value;
  }
  if (typeof value !== "object") return value;

  const obj = value as Record<string, unknown>;
  for (const key of [
    "text",
    "value",
    "content",
    "note",
    "summary",
    "title",
    "reason",
    "analysis",
    "zh",
    "en",
  ]) {
    if (typeof obj[key] === "string") return obj[key];
  }
  const first = findFirstString(obj);
  return first ?? value;
}

function findFirstString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findFirstString(child);
      if (found) return found;
    }
    return null;
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    const found = findFirstString(child);
    if (found) return found;
  }
  return null;
}

function parseStructuredJson<T extends z.ZodTypeAny>(
  schema: T,
  text: string,
): z.infer<T> {
  const raw = parseJsonObject(text);
  const direct = schema.safeParse(raw);
  if (direct.success) return direct.data as z.infer<T>;

  try {
    const jsonSchema = z.toJSONSchema(schema, {
      io: "input",
    }) as JsonSchemaObject;
    const normalized = normalizeForJsonSchema(raw, jsonSchema);
    const repaired = schema.safeParse(normalized);
    if (repaired.success) return repaired.data as z.infer<T>;
  } catch {
    // Fall through and throw the original Zod error for a useful path.
  }

  throw direct.error;
}

function deepSeekStructuredInstruction(
  schema: z.ZodTypeAny,
  schemaName?: string,
): string {
  return `Return only one valid JSON object${schemaName ? ` named ${schemaName}` : ""}.
Use exactly this JSON shape. Replace the empty strings with final prose. Do not wrap string fields in objects. Do not add markdown or explanation.

${schemaExample(schema)}`;
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
      timeout: llmCallTimeoutMs(),
      maxOutputTokens: req.maxTokens ?? 2048,
      providerOptions: reasoningProviderOptions(provider, req.reasoningEffort),
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
    if (provider === "azure-deepseek") {
      const instruction = deepSeekStructuredInstruction(
        req.schema,
        req.schemaName,
      );
      const requestedDeployment = req.deployment ?? deepSeekProDeployment();
      const candidateModels =
        requestedDeployment === deepSeekFlashDeployment()
          ? [model, modelFor(provider, { deployment: deepSeekProDeployment() })]
          : [model];
      let lastError: unknown = null;
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      for (const candidateModel of candidateModels) {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const result = await aiGenerateText({
              model: candidateModel,
              system: adjusted.system,
              messages: [
                ...adjusted.messages,
                {
                  role: "user",
                  content:
                    attempt === 0
                      ? instruction
                      : `Your previous response was invalid. Return ONLY valid JSON for this exact shape, with every value as the correct primitive type:\n\n${schemaExample(req.schema)}`,
                },
              ],
              timeout: llmCallTimeoutMs(),
              maxOutputTokens: req.maxTokens ?? 2048,
              temperature: req.temperature ?? 0,
            });
            totalInputTokens += result.usage?.inputTokens ?? 0;
            totalOutputTokens += result.usage?.outputTokens ?? 0;
            recordUsage({
              provider,
              model: modelId(candidateModel),
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
            const parsed = parseStructuredJson(req.schema, result.text);
            return {
              data: parsed as z.infer<T>,
              provider,
              model: modelId(candidateModel),
              inputTokens: totalInputTokens || undefined,
              outputTokens: totalOutputTokens || undefined,
            };
          } catch (err) {
            lastError = err;
          }
        }
      }
      throw lastError instanceof Error
        ? lastError
        : new Error(String(lastError));
    }

    const result = await aiGenerateObject({
      model,
      system: adjusted.system,
      messages: adjusted.messages,
      schema: req.schema,
      schemaName: req.schemaName,
      schemaDescription: req.schemaDescription,
      timeout: llmCallTimeoutMs(),
      maxOutputTokens: req.maxTokens ?? 2048,
      providerOptions: reasoningProviderOptions(provider, req.reasoningEffort),
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
    const result = await aiEmbed({
      model,
      value: req.value,
      abortSignal: AbortSignal.timeout(llmCallTimeoutMs()),
    });
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
    const result = await aiEmbedMany({
      model,
      values: req.values,
      abortSignal: AbortSignal.timeout(llmCallTimeoutMs()),
    });
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
  /** High-value summarization / tagging. DeepSeek V4 Pro handles both locales. */
  enrich: {
    provider: "azure-deepseek" as const,
    deployment: deepSeekProDeployment(),
    reasoningEffort: "low" as const,
  },
  /** High-value editorial scoring + recommendation rationale. */
  score: {
    provider: "azure-deepseek" as const,
    deployment: deepSeekProDeployment(),
    reasoningEffort: "low" as const,
  },
  /** M4 policy-iteration agent. Deepest reasoning. */
  agent: {
    provider: "azure-openai-pro" as const,
    reasoningEffort: "xhigh" as const,
  },
  /** Chinese prose generation. Same DeepSeek Pro deployment as high-value EN. */
  zhText: {
    provider: "azure-deepseek" as const,
    deployment: deepSeekProDeployment(),
    reasoningEffort: "low" as const,
  },
  /** Low-value bilingual prose and scoring. Same Azure DeepSeek endpoint/key,
   *  cheaper deployment, no separate English GPT-5.5 pass. */
  fastText: {
    provider: "azure-deepseek" as const,
    deployment: deepSeekFlashDeployment(),
    reasoningEffort: "low" as const,
  },
} satisfies Record<
  string,
  { provider: LLMProvider; deployment?: string; reasoningEffort: ReasoningEffort }
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
    process.env.AZURE_OPENAI_PRO_ENDPOINT &&
    process.env.AZURE_OPENAI_PRO_DEPLOYMENT
  ) {
    out.push("azure-openai-pro");
  }
  if (process.env.AZURE_DEEPSEEK_API_KEY && process.env.AZURE_DEEPSEEK_ENDPOINT) {
    out.push("azure-deepseek");
  }
  return out;
}
