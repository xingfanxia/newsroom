import { formatCoarseRelativeTime } from "@/lib/time/relative";
import {
  createPublicStateIndex,
  publicStoryFromItem,
  type PublicStateIndex,
} from "@/lib/public-content/public-items";
import type { AppLocale } from "@/lib/types";

export function publicPolicySummary(
  value: unknown,
  nowMs: number,
): { version: string; lastIterAt: string | null } {
  const policy = createPublicStateIndex(value).state.policies
    .filter((candidate) => candidate.skillName === "editorial")
    .sort((left, right) => right.committedAt.localeCompare(left.committedAt))[0];
  if (!policy) return { version: "v1", lastIterAt: null };
  return {
    version: policy.version,
    lastIterAt: formatCoarseRelativeTime(policy.committedAt, {
      now: new Date(nowMs),
      currentLabel: "just now",
      hourSuffix: " hrs",
    }),
  };
}

export function publicPageItemDetail(
  value: unknown,
  id: number,
  locale: AppLocale,
  nowMs: number,
  resolvedBodyMd: string | null = null,
) {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const index = createPublicStateIndex(value);
  return publicPageItemDetailFromIndex(
    index,
    id,
    locale,
    nowMs,
    resolvedBodyMd,
  );
}

export function publicPageItemDetailFromIndex(
  index: Pick<PublicStateIndex, "itemsById" | "eventsById" | "sourcesById">,
  id: number,
  locale: AppLocale,
  nowMs: number,
  resolvedBodyMd: string | null = null,
) {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const item = index.itemsById.get(id);
  if (!item) return null;
  return {
    story: publicStoryFromItem(index, item, {
      locale,
      includeSourceGroup: true,
      nowMs,
      tagLimit: 6,
    }),
    bodyMd: item.bodyMd ?? resolvedBodyMd,
  };
}
