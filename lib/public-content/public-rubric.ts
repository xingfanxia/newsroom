import type { AppLocale } from "@/lib/types";

type PublicHkr = { h: boolean; k: boolean; r: boolean };

export type PublicRubricFacts = {
  locale: AppLocale;
  tier: string | null;
  importance: number;
  hkr: PublicHkr | null;
};

const LABELS = {
  en: { prefix: "Featured", importance: "importance", h: "hook", k: "knowledge", r: "resonance", none: "editorial signal" },
  zh: { prefix: "精选", importance: "重要度", h: "吸引力", k: "知识量", r: "共鸣", none: "编辑信号" },
} as const;

/**
 * Public replacement for raw scorer reasoning. It accepts only persisted,
 * non-sensitive rubric facts, so caller-provided prose cannot influence copy.
 */
export function deriveWhyFeatured(facts: PublicRubricFacts): string | null {
  if (facts === null || typeof facts !== "object") return null;
  if (facts.locale !== "en" && facts.locale !== "zh") return null;
  if (facts.tier !== "featured" && facts.tier !== "p1") return null;
  if (
    !Number.isInteger(facts.importance) ||
    facts.importance < 0 ||
    facts.importance > 100
  ) {
    return null;
  }
  if (
    facts.hkr !== null &&
    (typeof facts.hkr !== "object" ||
      typeof facts.hkr.h !== "boolean" ||
      typeof facts.hkr.k !== "boolean" ||
      typeof facts.hkr.r !== "boolean")
  ) {
    return null;
  }
  const labels = LABELS[facts.locale];
  const signals = facts.hkr
    ? (["h", "k", "r"] as const)
        .filter((axis) => facts.hkr?.[axis])
        .map((axis) => labels[axis])
    : [];
  return `${labels.prefix} · ${labels.importance} ${facts.importance} · ${signals.length > 0 ? signals.join(" + ") : labels.none}`;
}
