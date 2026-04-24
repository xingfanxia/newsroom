/**
 * Event-level importance + approximate tier computation.
 *
 * Importance formula (spec §6.5):
 *   final = min(max(member.importance) + round(log2(1 + coverage) * 6), 100)
 *
 * The log2 boost caps diminishing returns:
 *   coverage=1  → boost=6     (singleton)
 *   coverage=2  → boost=10
 *   coverage=4  → boost=14
 *   coverage=8  → boost=19
 *   coverage=16 → boost=24
 *
 * Tier mapping is deliberately a simple bucket here and NOT intended to
 * match the per-item scorer's HKR-gated rubric exactly. The scorer
 * (workers/enrich/prompt.ts) uses:
 *   p1       = importance >= 85 AND hkr.h + hkr.k + hkr.r === 3
 *   featured = importance >= 72 AND hkr_sum >= 2
 *   all      = importance >= 40
 *   excluded = importance < 40 OR hard-exclusion
 *
 * That's LLM judgment. For event-level, `approximateTierForImportance`
 * produces a reasonable bucket from importance alone — used by the
 * Stage B arbitrator for post-split transient recompute and by the
 * migration script as an initial seed. The real tier is re-established
 * by Stage D (event commentary) which re-invokes the scorer LLM against
 * event-level signal.
 */

export type EventTier = "featured" | "p1" | "all" | "excluded";

export interface MemberImportanceInput {
  importance: number | null | undefined;
}

export interface EventImportanceResult {
  importance: number;
  coverage: number;
  base: number;
  boost: number;
}

/** Compute event importance from its member items. Pure function. */
export function recomputeEventImportance(
  members: MemberImportanceInput[],
): EventImportanceResult {
  if (members.length === 0) {
    throw new Error(
      "recomputeEventImportance: at least one member required",
    );
  }
  const base = Math.max(...members.map((m) => m.importance ?? 0));
  const coverage = members.length;
  const boost = Math.round(Math.log2(1 + coverage) * 6);
  const importance = Math.min(base + boost, 100);
  return { importance, coverage, base, boost };
}

/**
 * Map importance → tier using a simple bucket. APPROXIMATION of the
 * per-item scorer's rubric (which also gates on HKR). Safe for:
 *   - Stage B post-split transient recompute (tier gets overwritten by
 *     the next scorer run anyway)
 *   - Migration seeding
 *   - Tests that don't exercise the scorer
 *
 * Do NOT use this as a source of truth for reader-facing tier. The
 * scorer LLM is.
 */
export function approximateTierForImportance(importance: number): EventTier {
  if (importance >= 85) return "p1";
  if (importance >= 72) return "featured";
  if (importance >= 40) return "all";
  return "excluded";
}

/**
 * Union member HKR into event HKR: any member with an axis=true propagates it.
 * Editorial intent: if one source caught an angle (headline / novel knowledge /
 * real-impact) that others missed, the event has that angle.
 */
export interface HkrLike {
  h?: boolean | null;
  k?: boolean | null;
  r?: boolean | null;
}

export function unionHkr(members: HkrLike[]): {
  h: boolean;
  k: boolean;
  r: boolean;
} {
  return {
    h: members.some((m) => m.h === true),
    k: members.some((m) => m.k === true),
    r: members.some((m) => m.r === true),
  };
}
