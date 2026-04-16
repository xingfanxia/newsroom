import type { ModelMessage } from "ai";
import type { z } from "zod";

export type LLMProvider =
  | "anthropic"
  | "gemini"
  | "azure-openai"
  | "azure-openai-pro";

export type ReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

export type GenerateTextRequest = {
  provider?: LLMProvider;
  /** Override the default deployment for this provider (mainly for Azure). */
  deployment?: string;
  /** GPT-5 family reasoning effort. Provider-specific allowed values:
   *   - gpt-5.4-standard: minimal | low | medium | high
   *   - gpt-5.4-pro:      medium | high | xhigh
   */
  reasoningEffort?: ReasoningEffort;
  system?: string;
  messages: ModelMessage[];
  maxTokens?: number;
  /** Reasoning-family models (Opus 4.7, Gemini 3 Pro, GPT-5) reject temperature.
   *  Only pass it when calling non-reasoning models. */
  temperature?: number;
};

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
};

export type EmbedManyRequest = {
  provider?: LLMProvider;
  values: string[];
  dimensions?: number;
};

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

export type { ModelMessage } from "ai";
