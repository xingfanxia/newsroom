import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import type {
  GenerateTextOptions,
  GenerateStructuredOptions,
  GenerateTextResult,
  GenerateStructuredResult,
} from "./types";
import { LLMError } from "./types";

let cached: GoogleGenAI | null = null;
function client() {
  if (!process.env.GEMINI_API_KEY) {
    throw new LLMError("gemini", "GEMINI_API_KEY is not set");
  }
  cached ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return cached;
}

const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.1-pro";

export async function geminiGenerate(
  opts: GenerateTextOptions,
): Promise<GenerateTextResult> {
  try {
    const contents = opts.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

    const response = await client().models.generateContent({
      model: MODEL,
      contents,
      config: {
        systemInstruction: opts.system,
        maxOutputTokens: opts.maxTokens ?? 2048,
        temperature: opts.temperature ?? 0.7,
      },
    });

    const text = response.text ?? "";
    return {
      text,
      provider: "gemini",
      model: MODEL,
    };
  } catch (err) {
    throw new LLMError("gemini", "Gemini generation failed", err);
  }
}

export async function geminiStructured<T extends z.ZodTypeAny>(
  opts: GenerateStructuredOptions<T>,
): Promise<GenerateStructuredResult<T>> {
  const schemaPrompt = `Respond with ONLY JSON. No markdown fences.`;
  const system = [opts.system, schemaPrompt].filter(Boolean).join("\n\n");
  const { text, model } = await geminiGenerate({ ...opts, system });
  const trimmed = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const parsed = opts.schema.safeParse(JSON.parse(trimmed));
  if (!parsed.success) {
    throw new LLMError(
      "gemini",
      `schema validation failed: ${parsed.error.message}`,
    );
  }
  return { data: parsed.data, raw: text, provider: "gemini", model };
}
