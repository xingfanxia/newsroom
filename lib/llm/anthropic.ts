import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type {
  GenerateTextOptions,
  GenerateStructuredOptions,
  GenerateTextResult,
  GenerateStructuredResult,
} from "./types";
import { LLMError } from "./types";

let cached: Anthropic | null = null;
function client() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new LLMError("anthropic", "ANTHROPIC_API_KEY is not set");
  }
  cached ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return cached;
}

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-4-7";

export async function anthropicGenerate(
  opts: GenerateTextOptions,
): Promise<GenerateTextResult> {
  try {
    const msg = await client().messages.create({
      model: MODEL,
      max_tokens: opts.maxTokens ?? 2048,
      temperature: opts.temperature ?? 0.7,
      system: opts.system,
      messages: opts.messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    });
    const text = msg.content
      .filter((c): c is Anthropic.TextBlock => c.type === "text")
      .map((c) => c.text)
      .join("");
    return {
      text,
      provider: "anthropic",
      model: MODEL,
      inputTokens: msg.usage?.input_tokens,
      outputTokens: msg.usage?.output_tokens,
    };
  } catch (err) {
    throw new LLMError("anthropic", "Claude generation failed", err);
  }
}

export async function anthropicStructured<T extends z.ZodTypeAny>(
  opts: GenerateStructuredOptions<T>,
): Promise<GenerateStructuredResult<T>> {
  const schemaPrompt = `Respond with ONLY valid JSON (no markdown fences, no prose). The response will be parsed against a strict schema named "${opts.schemaName}".`;
  const system = [opts.system, schemaPrompt].filter(Boolean).join("\n\n");
  const { text, model } = await anthropicGenerate({
    ...opts,
    system,
  });
  const trimmed = stripFences(text);
  const parsed = opts.schema.safeParse(JSON.parse(trimmed));
  if (!parsed.success) {
    throw new LLMError(
      "anthropic",
      `schema validation failed: ${parsed.error.message}`,
    );
  }
  return { data: parsed.data, raw: text, provider: "anthropic", model };
}

function stripFences(s: string) {
  return s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}
