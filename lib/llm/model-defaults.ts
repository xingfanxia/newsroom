/**
 * Current default model/deployment labels used when env overrides are absent.
 *
 * Keep provider routing, pricing fallback, and operator cost forecasts on this
 * shared contract so deployment swaps do not require synchronized string edits.
 */
export const LLM_MODEL_DEFAULTS = {
  azureOpenAIChat: "gpt-5.5-standard",
  azureDeepSeekPro: "DeepSeek-V4-Pro",
  azureDeepSeekFlash: "DeepSeek-V4-Flash",
  embedding: "text-embedding-3-large",
  anthropic: "claude-opus-4-7",
  gemini: "gemini-3.1-pro-preview",
} as const;
