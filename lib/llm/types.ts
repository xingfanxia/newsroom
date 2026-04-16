import { z } from "zod";

export type LLMProvider = "anthropic" | "gemini" | "azure-openai";

export type LLMMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type GenerateTextOptions = {
  provider?: LLMProvider;
  system?: string;
  messages: LLMMessage[];
  maxTokens?: number;
  temperature?: number;
};

export type GenerateStructuredOptions<T extends z.ZodTypeAny> =
  GenerateTextOptions & {
    schema: T;
    schemaName: string;
  };

export type GenerateTextResult = {
  text: string;
  provider: LLMProvider;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
};

export type GenerateStructuredResult<T extends z.ZodTypeAny> = {
  data: z.infer<T>;
  raw: string;
  provider: LLMProvider;
  model: string;
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
