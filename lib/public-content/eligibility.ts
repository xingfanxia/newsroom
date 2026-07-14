import { isVisibleItemTier } from "@/lib/types";
import { utcIsoTimestampSchema } from "./contract-primitives";

export type PublicItemEligibility = {
  id: number;
  enrichedAt: string | null;
  importance: number | null;
  tier: string | null;
  intendedPublic: boolean;
};

export type PublicEventEligibility = {
  leadItemId: number;
  memberItemIds: readonly number[];
  noContent: boolean;
  tier: string | null;
};

export function isEligiblePublicItem(item: PublicItemEligibility): boolean {
  if (item === null || typeof item !== "object") return false;
  return (
    item.intendedPublic === true &&
    Number.isSafeInteger(item.id) &&
    item.id > 0 &&
    utcIsoTimestampSchema.safeParse(item.enrichedAt).success &&
    typeof item.importance === "number" &&
    Number.isInteger(item.importance) &&
    item.importance >= 0 &&
    item.importance <= 100 &&
    Number.isFinite(item.importance) &&
    isVisibleItemTier(item.tier)
  );
}

export function eligibleCanonicalItemIds(
  items: readonly PublicItemEligibility[],
): number[] {
  return items.filter(isEligiblePublicItem).map((item) => item.id);
}

export function isEligiblePublicEvent(
  event: PublicEventEligibility,
  members: readonly PublicItemEligibility[],
): boolean {
  if (
    event === null ||
    typeof event !== "object" ||
    !Array.isArray(members) ||
    event.noContent !== false ||
    !Array.isArray(event.memberItemIds) ||
    (event.tier !== null && typeof event.tier !== "string")
  ) {
    return false;
  }
  const uniqueMembers = new Set(event.memberItemIds);
  if (
    event.memberItemIds.length < 2 ||
    uniqueMembers.size !== event.memberItemIds.length ||
    !uniqueMembers.has(event.leadItemId)
  ) {
    return false;
  }
  const resolvedMembers = event.memberItemIds.map((memberId) =>
    members.filter((member) => member?.id === memberId),
  );
  if (
    resolvedMembers.some(
      (matches) => matches.length !== 1 || !isEligiblePublicItem(matches[0]!),
    )
  ) {
    return false;
  }
  const lead = resolvedMembers
    .flat()
    .find((item) => item.id === event.leadItemId);
  if (!lead) return false;
  return isVisibleItemTier(event.tier ?? lead.tier);
}

/** `enabled` controls future ingestion, never historical public visibility. */
export function retainPublicSourceHistory(source: {
  enabled: boolean;
}): true {
  void source.enabled;
  return true;
}
