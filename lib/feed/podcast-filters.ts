import { VISIBLE_ITEM_TIERS, type VisibleItemTier } from "@/lib/types";

export const PODCAST_TIERS = [
  VISIBLE_ITEM_TIERS[0],
  VISIBLE_ITEM_TIERS[2],
] as const satisfies readonly VisibleItemTier[];
export type PodcastTier = (typeof PODCAST_TIERS)[number];
export const DEFAULT_PODCAST_TIER = PODCAST_TIERS[0];

const PODCAST_TIER_SET = new Set<string>(PODCAST_TIERS);

export function coercePodcastTier(
  value: string | null | undefined,
): PodcastTier {
  return value && PODCAST_TIER_SET.has(value)
    ? (value as PodcastTier)
    : DEFAULT_PODCAST_TIER;
}
