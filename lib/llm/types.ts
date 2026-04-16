import type { ModelMessage } from "ai";
import type { z } from "zod";

export type LLMProvider = "anthropic" | "gemini" | "azure-openai";

export type GenerateTextRequest = {
  provider?: LLMProvider;
  system?: string;
  messages: ModelMessage[];
  maxTokens?: number;
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

// Re-export ModelMessage for callers that want to build messages inline.
export type { ModelMessage } from "ai";
