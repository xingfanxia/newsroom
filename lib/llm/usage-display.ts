import type { WindowKey } from "@/lib/llm/stats";
import { isLLMTask, type LLMTask } from "@/lib/llm/types";

export type UsageLocale = "en" | "zh";
export type UsageTaskTone = "g" | "b" | "o" | "r" | "";

export const USAGE_RANGE_LABELS = {
  today: { en: "today", zh: "今日" },
  week: { en: "past 7d", zh: "近 7 天" },
  month: { en: "past 30d", zh: "近 30 天" },
  all: { en: "all-time", zh: "全量" },
} as const satisfies Record<WindowKey, Record<UsageLocale, string>>;

export const USAGE_TASK_TONES = {
  enrich: "b",
  score: "g",
  embed: "",
  commentary: "o",
  "event-commentary": "o",
  newsletter: "o",
  "daily-column": "o",
  agent: "r",
  search: "r",
  arbitrate: "b",
  "canonical-title": "b",
  other: "",
} as const satisfies Record<LLMTask, UsageTaskTone>;

export function usageRangeLabel(
  window: WindowKey,
  locale: UsageLocale,
): string {
  return USAGE_RANGE_LABELS[window][locale];
}

export function usageTaskTone(task: string | null | undefined): UsageTaskTone {
  return task && isLLMTask(task) ? USAGE_TASK_TONES[task] : "";
}

export function formatUsageTokens(n: number): string {
  return compactUsageNumber(n);
}

export function formatUsageCount(n: number): string {
  return compactUsageNumber(n);
}

function compactUsageNumber(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

export function formatUsageTaskModels(
  models: { model: string; calls: number; provider: string }[],
): string {
  if (models.length === 0) return "—";
  return models
    .slice(0, 2)
    .map((m) => `${formatUsageModelLabel(m)} ${formatUsageCount(m.calls)}`)
    .join(" · ");
}

export function formatUsageModelLabel(model: {
  provider: string;
  model: string;
}): string {
  return `${model.provider}/${model.model}`;
}

export function formatUsageShortDate(iso: string): string {
  const [, mm, dd] = iso.split("-");
  return `${mm}·${dd}`;
}
