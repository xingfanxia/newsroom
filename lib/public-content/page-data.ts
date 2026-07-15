import { formatCoarseRelativeTime } from "@/lib/time/relative";
import { createPublicStateIndex, publicStoryFromItem } from "@/lib/public-content/public-items";
import { publicSnapshotReader } from "@/lib/public-content/reader";
import type { PublicCanonicalStateResult } from "@/lib/public-content/reader/types";
import type { AppLocale } from "@/lib/types";

export type PublicPageSnapshot = PublicCanonicalStateResult & {
  nowMs: number;
};

export async function readPublicPageSnapshot(): Promise<PublicPageSnapshot> {
  const snapshot = await publicSnapshotReader().readCanonicalState();
  return { ...snapshot, nowMs: Date.now() };
}

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
) {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const index = createPublicStateIndex(value);
  const item = index.itemsById.get(id);
  if (!item) return null;
  return {
    story: publicStoryFromItem(index, item, {
      locale,
      includeSourceGroup: true,
      nowMs,
      tagLimit: 6,
    }),
    bodyMd: item.bodyMd,
  };
}
