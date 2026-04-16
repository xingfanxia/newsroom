/**
 * LiteLLM model pricing fetcher + cost calculator.
 *
 * LiteLLM publishes a canonical JSON dictionary of per-token costs for every
 * known model at:
 *   https://raw.githubusercontent.com/BerriAI/litellm/main/litellm/model_prices_and_context_window_backup.json
 *
 * We cache it in memory with a 24h TTL — the file is rebuilt by LiteLLM
 * maintainers, not a hot-path dependency. Fallback to a tiny hardcoded
 * table for the models we use most so cost tracking never crashes.
 *
 * Model name matching is fuzzy:
 *   1. exact match on the full model string
 *   2. exact match after stripping common provider prefixes ("azure/", "openai/")
 *   3. prefix match on Azure deployment names (e.g. "gpt-5.4-standard" →
 *      first row whose key startsWith "gpt-5.4")
 *   4. fallback to the hardcoded table
 */
import type { LLMProvider } from "./types";

const PRICING_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/litellm/model_prices_and_context_window_backup.json";
const TTL_MS = 24 * 60 * 60 * 1000;

type LiteLLMModelRow = {
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  cache_read_input_token_cost?: number;
  cache_creation_input_token_cost?: number;
  input_cost_per_token_above_128k_tokens?: number;
  output_cost_per_token_above_128k_tokens?: number;
  litellm_provider?: string;
  mode?: string;
};

export type ModelPricing = {
  inputCostPerToken: number;
  outputCostPerToken: number;
  cachedInputCostPerToken?: number;
};

type Cache = {
  fetchedAt: number;
  rows: Record<string, LiteLLMModelRow>;
};

let cache: Cache | null = null;
let inFlight: Promise<Cache> | null = null;

/**
 * Fallback prices for the models we rely on. Keep in sync with our provider
 * contracts; used when the LiteLLM fetch fails or the model isn't indexed.
 * Values are per-token (USD). Azure standard rates are lifted from the public
 * pricing page; pro reasoning is estimated from GPT-5 pro pricing family.
 */
const FALLBACK: Record<string, ModelPricing> = {
  // GPT-5.4 family (Azure — estimate based on o-series pricing patterns)
  "gpt-5.4-standard": {
    inputCostPerToken: 0.0000025,
    outputCostPerToken: 0.00001,
    cachedInputCostPerToken: 0.00000125,
  },
  "gpt-5.4-pro-standard": {
    inputCostPerToken: 0.000015,
    outputCostPerToken: 0.00006,
    cachedInputCostPerToken: 0.0000075,
  },
  // Embedding
  "text-embedding-3-large": {
    inputCostPerToken: 0.00000013,
    outputCostPerToken: 0,
  },
  // Claude Opus 4.7 (Anthropic public pricing)
  "claude-opus-4-7": {
    inputCostPerToken: 0.000015,
    outputCostPerToken: 0.000075,
    cachedInputCostPerToken: 0.0000015,
  },
  // Gemini 3.1 Pro Preview (estimated from Gemini pricing patterns)
  "gemini-3.1-pro-preview": {
    inputCostPerToken: 0.00000125,
    outputCostPerToken: 0.00001,
  },
};

async function loadPricing(): Promise<Cache> {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) return cache;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const res = await fetch(PRICING_URL, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`pricing fetch status ${res.status}`);
      const rows = (await res.json()) as Record<string, LiteLLMModelRow>;
      cache = { fetchedAt: Date.now(), rows };
      return cache;
    } catch {
      // Return an empty rowset so lookup falls through to FALLBACK
      cache = { fetchedAt: Date.now(), rows: {} };
      return cache;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

function stripProviderPrefix(name: string): string {
  return name.replace(/^(azure\/|openai\/|anthropic\/|google\/|vertex_ai\/)/i, "");
}

function rowToPricing(row: LiteLLMModelRow): ModelPricing | null {
  const inCost = row.input_cost_per_token;
  const outCost = row.output_cost_per_token;
  if (typeof inCost !== "number" || typeof outCost !== "number") return null;
  return {
    inputCostPerToken: inCost,
    outputCostPerToken: outCost,
    cachedInputCostPerToken: row.cache_read_input_token_cost,
  };
}

export async function resolvePricing(
  model: string,
  _provider?: LLMProvider,
): Promise<ModelPricing | null> {
  // Provider is reserved for future disambiguation (e.g. Azure vs OpenAI deployments
  // that share a family name). Not used yet but keeps callers stable when we wire it in.
  const { rows } = await loadPricing();
  const stripped = stripProviderPrefix(model);
  // 1. exact match on the raw model string
  if (rows[model]) {
    const p = rowToPricing(rows[model]);
    if (p) return p;
  }
  // 2. exact after stripping provider prefix
  if (rows[stripped]) {
    const p = rowToPricing(rows[stripped]);
    if (p) return p;
  }
  // 3. prefix match for Azure deployments (e.g. "gpt-5.4-standard" → "gpt-5.4")
  const candidateKey = Object.keys(rows).find(
    (k) =>
      stripped.startsWith(k) &&
      // avoid matching every "gpt-" row for "gpt-5.4-standard"
      (k.includes("-") || k.length >= 6),
  );
  if (candidateKey) {
    const p = rowToPricing(rows[candidateKey]);
    if (p) return p;
  }
  // 4. hardcoded fallback
  if (FALLBACK[stripped]) return FALLBACK[stripped];
  if (FALLBACK[model]) return FALLBACK[model];
  // 5. last-ditch family prefix on FALLBACK
  const fallbackKey = Object.keys(FALLBACK).find((k) => stripped.startsWith(k));
  return fallbackKey ? FALLBACK[fallbackKey] : null;
}

export type UsageTokens = {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
};

/**
 * Compute USD cost from token counts + resolved pricing. Returns null when the
 * pricing is unknown so the caller can persist `null` rather than `0`.
 */
export function computeCost(
  tokens: UsageTokens,
  pricing: ModelPricing | null,
): number | null {
  if (!pricing) return null;
  const {
    inputTokens = 0,
    cachedInputTokens = 0,
    outputTokens = 0,
    reasoningTokens = 0,
  } = tokens;
  // Cached tokens priced separately when available; otherwise billed at normal input rate
  const uncachedInput = Math.max(0, inputTokens - cachedInputTokens);
  const cachedCost =
    cachedInputTokens *
    (pricing.cachedInputCostPerToken ?? pricing.inputCostPerToken);
  const inputCost = uncachedInput * pricing.inputCostPerToken;
  // Reasoning tokens are billed as output by every provider we use
  const outputCost = (outputTokens + reasoningTokens) * pricing.outputCostPerToken;
  return Number((cachedCost + inputCost + outputCost).toFixed(6));
}
