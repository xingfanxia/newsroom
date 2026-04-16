/**
 * Per-call LLM usage logger. Writes to the `llm_usage` table for cost tracking.
 *
 * Logging is fire-and-forget from the caller's perspective: we never block the
 * LLM result on the DB insert, and we catch + console.error any persistence
 * failure so production Fluid invocations never crash on bookkeeping bugs.
 */
import { db } from "@/db/client";
import { llmUsage } from "@/db/schema";
import type { LLMProvider, LLMTask } from "./types";
import { resolvePricing, computeCost, type UsageTokens } from "./pricing";

export type RecordUsageArgs = {
  provider: LLMProvider;
  model: string;
  task?: LLMTask;
  itemId?: number;
  tokens: UsageTokens;
  durationMs: number;
};

export function recordUsage(args: RecordUsageArgs): Promise<void> {
  return persist(args).catch((err) => {
    // Never let accounting failures break the hot path. Surface to logs only.
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[llm_usage] persist failed:", msg);
  });
}

async function persist(args: RecordUsageArgs): Promise<void> {
  const pricing = await resolvePricing(args.model, args.provider);
  const cost = computeCost(args.tokens, pricing);
  const client = db();
  await client.insert(llmUsage).values({
    provider: args.provider,
    model: args.model,
    task: args.task ?? null,
    inputTokens: args.tokens.inputTokens ?? 0,
    cachedInputTokens: args.tokens.cachedInputTokens ?? 0,
    outputTokens: args.tokens.outputTokens ?? 0,
    reasoningTokens: args.tokens.reasoningTokens ?? 0,
    costUsd: cost !== null ? String(cost) : null,
    itemId: args.itemId ?? null,
    durationMs: args.durationMs,
  });
}

/**
 * Extract provider-specific cached-token counts from the Vercel AI SDK's
 * `providerMetadata` bag. Different providers expose cached tokens under
 * different keys; we normalize here.
 */
export function extractCachedTokens(
  providerMetadata: Record<string, unknown> | undefined,
): number {
  if (!providerMetadata) return 0;
  // OpenAI / Azure OpenAI
  const openai = providerMetadata.openai as
    | { cachedPromptTokens?: number; cached_tokens?: number }
    | undefined;
  if (openai) {
    return openai.cachedPromptTokens ?? openai.cached_tokens ?? 0;
  }
  // Anthropic (cache_read_input_tokens)
  const anthropic = providerMetadata.anthropic as
    | { cacheReadInputTokens?: number }
    | undefined;
  if (anthropic?.cacheReadInputTokens) return anthropic.cacheReadInputTokens;
  return 0;
}

/**
 * Extract reasoning tokens (for o-series / GPT-5 family / Gemini reasoning).
 */
export function extractReasoningTokens(
  providerMetadata: Record<string, unknown> | undefined,
): number {
  if (!providerMetadata) return 0;
  const openai = providerMetadata.openai as
    | { reasoningTokens?: number }
    | undefined;
  if (openai?.reasoningTokens) return openai.reasoningTokens;
  const google = providerMetadata.google as
    | { thoughtsTokenCount?: number }
    | undefined;
  if (google?.thoughtsTokenCount) return google.thoughtsTokenCount;
  return 0;
}
