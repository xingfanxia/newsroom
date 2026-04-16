import { AzureOpenAI } from "openai";
import { z } from "zod";
import type {
  GenerateTextOptions,
  GenerateStructuredOptions,
  GenerateTextResult,
  GenerateStructuredResult,
} from "./types";
import { LLMError } from "./types";

let cached: AzureOpenAI | null = null;
function client() {
  const key = process.env.AZURE_OPENAI_API_KEY;
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION ?? "2024-12-01-preview";
  if (!key || !endpoint || !deployment) {
    throw new LLMError(
      "azure-openai",
      "Azure OpenAI env not fully set (need AZURE_OPENAI_API_KEY, AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_DEPLOYMENT)",
    );
  }
  cached ??= new AzureOpenAI({
    apiKey: key,
    endpoint,
    deployment,
    apiVersion,
  });
  return cached;
}

const MODEL = process.env.AZURE_OPENAI_MODEL ?? "gpt-5.4";

export async function azureOpenAIGenerate(
  opts: GenerateTextOptions,
): Promise<GenerateTextResult> {
  try {
    const messages: { role: "system" | "user" | "assistant"; content: string }[] =
      [];
    if (opts.system) messages.push({ role: "system", content: opts.system });
    messages.push(...opts.messages);

    const response = await client().chat.completions.create({
      messages,
      model: MODEL,
      max_completion_tokens: opts.maxTokens ?? 2048,
      temperature: opts.temperature ?? 0.7,
    });
    const text = response.choices?.[0]?.message?.content ?? "";
    return {
      text,
      provider: "azure-openai",
      model: MODEL,
      inputTokens: response.usage?.prompt_tokens,
      outputTokens: response.usage?.completion_tokens,
    };
  } catch (err) {
    throw new LLMError("azure-openai", "Azure OpenAI generation failed", err);
  }
}

export async function azureOpenAIStructured<T extends z.ZodTypeAny>(
  opts: GenerateStructuredOptions<T>,
): Promise<GenerateStructuredResult<T>> {
  const schemaPrompt = `Respond with ONLY JSON. No markdown fences.`;
  const system = [opts.system, schemaPrompt].filter(Boolean).join("\n\n");
  const { text, model } = await azureOpenAIGenerate({ ...opts, system });
  const trimmed = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const parsed = opts.schema.safeParse(JSON.parse(trimmed));
  if (!parsed.success) {
    throw new LLMError(
      "azure-openai",
      `schema validation failed: ${parsed.error.message}`,
    );
  }
  return { data: parsed.data, raw: text, provider: "azure-openai", model };
}
