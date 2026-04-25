import { readFileSync } from "node:fs";
import { join } from "node:path";

let cached: string | null = null;

/**
 * Loads the canonical daily-column voice + structure spec.
 * Memoized after first call. The path is repo-relative; in Vercel deploy the
 * file is included by Next's tracing because it's reached transitively from
 * the cron route handler.
 */
export function loadDailyColumnPrompt(): string {
  if (cached !== null) return cached;
  const path = join(process.cwd(), "lib/llm/prompts/daily-column.md");
  cached = readFileSync(path, "utf8");
  return cached;
}

/** Test-only — clear the memo. */
export function __resetDailyColumnPromptCache(): void {
  cached = null;
}
