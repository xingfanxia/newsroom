import type { Story } from "@/lib/types";
import {
  toApiItemCommonFields,
  toApiItemEventFields,
  type ApiItemCommonFields,
  type ApiItemEventFields,
} from "@/lib/api/story-item-fields";

type PublicHkr = { h: boolean; k: boolean; r: boolean };

export type PublicApiItem = ApiItemCommonFields<PublicHkr> & ApiItemEventFields;

function toPublicHkr(hkr: Story["hkr"]): PublicHkr | null {
  return hkr ? { h: hkr.h, k: hkr.k, r: hkr.r } : null;
}

/**
 * Shared anonymous /api/public item contract.
 * Keeps user-visible ranking/event fields while stripping LLM-internal
 * reasoning and per-axis HKR explanations.
 */
export function toPublicApiItem(
  story: Story,
  locale: "zh" | "en",
): PublicApiItem {
  return {
    ...toApiItemCommonFields(story, toPublicHkr(story.hkr)),
    ...toApiItemEventFields(story, locale),
  };
}
