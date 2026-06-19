import type { ModelMessage } from "ai";
import type { z } from "zod";

export const LLM_PROVIDERS = [
  "anthropic",
  "gemini",
  "azure-openai",
  "azure-openai-pro",
  "azure-deepseek",
] as const;
export type LLMProvider = (typeof LLM_PROVIDERS)[number];

export const REASONING_EFFORTS = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/** Business task label — used for cost accounting in the llm_usage table. */
export const LLM_TASKS = [
  "enrich",
  "score",
  "embed",
  "commentary",
  "event-commentary",
  "newsletter",
  "daily-column",
  "agent",
  "search",
  "arbitrate",
  "canonical-title",
  "other",
] as const;
export type LLMTask = (typeof LLM_TASKS)[number];

export function isLLMProvider(value: string): value is LLMProvider {
  return (LLM_PROVIDERS as readonly string[]).includes(value);
}

export function isReasoningEffort(value: string): value is ReasoningEffort {
  return (REASONING_EFFORTS as readonly string[]).includes(value);
}

export function isLLMTask(value: string): value is LLMTask {
  return (LLM_TASKS as readonly string[]).includes(value);
}

type LLMUsageContext = {
  /** Categorizes the call for cost dashboards. */
  task?: LLMTask;
  /** Link usage back to the item being processed, when applicable. */
  itemId?: number;
};

export type GenerateTextRequest = {
  provider?: LLMProvider;
  /** Override the default deployment for this provider (mainly for Azure). */
  deployment?: string;
  /** Reasoning effort. Provider-specific support:
   *   - azure-openai compatibility deployments: minimal | low | medium | high
   *   - azure-openai-pro deployments: medium | high | xhigh
   */
  reasoningEffort?: ReasoningEffort;
  system?: string;
  messages: ModelMessage[];
  maxTokens?: number;
  /** Reasoning-family models reject temperature. Only pass it when calling
   *  non-reasoning deployments. */
  temperature?: number;
} & LLMUsageContext;

export type GenerateStructuredRequest<T extends z.ZodTypeAny> =
  GenerateTextRequest & {
    schema: T;
    schemaName?: string;
    schemaDescription?: string;
  };

export type GenerateTextResult = {
  text: string;
  provider: LLMProvider;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  reasoningText?: string;
};

export type GenerateStructuredResult<T extends z.ZodTypeAny> = {
  data: z.infer<T>;
  provider: LLMProvider;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
};

export type EmbedRequest = {
  provider?: LLMProvider;
  value: string;
  dimensions?: number;
} & LLMUsageContext;

export type EmbedManyRequest = {
  provider?: LLMProvider;
  values: string[];
  dimensions?: number;
} & LLMUsageContext;

export type EmbedResult = {
  embedding: number[];
  provider: LLMProvider;
  model: string;
  tokens?: number;
};

export type EmbedManyResult = {
  embeddings: number[][];
  provider: LLMProvider;
  model: string;
  tokens?: number;
};

export class LLMError extends Error {
  constructor(
    public provider: LLMProvider,
    message: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = "LLMError";
  }
}
