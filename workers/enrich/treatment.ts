export type EnrichTreatment = "fast" | "high";

export const HIGH_VALUE_IMPORTANCE_THRESHOLD = 72;

export function treatmentForScore(score: {
  importance: number | null | undefined;
  tier: string | null | undefined;
}): EnrichTreatment {
  if (score.tier === "featured" || score.tier === "p1") return "high";
  return (score.importance ?? 0) >= HIGH_VALUE_IMPORTANCE_THRESHOLD
    ? "high"
    : "fast";
}
