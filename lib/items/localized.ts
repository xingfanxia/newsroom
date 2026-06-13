import type { AppLocale } from "@/lib/types";

type LocalizedText = {
  en?: string | null;
  zh?: string | null;
  fallback?: string | null;
};

export function pickLocalizedText(
  locale: AppLocale,
  text: LocalizedText,
): string | null {
  const primary = locale === "en" ? text.en : text.zh;
  const secondary = locale === "en" ? text.zh : text.en;
  return primary ?? secondary ?? text.fallback ?? null;
}

export function pickSameLocaleText(
  locale: AppLocale,
  text: LocalizedText,
): string | null {
  return (locale === "en" ? text.en : text.zh) ?? null;
}
