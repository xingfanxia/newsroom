import type { Story } from "@/lib/types";
import {
  toApiItemCommonFields,
  toApiItemEventFields,
  toPublicHkr,
  type ApiItemCommonFields,
  type ApiItemEventFields,
  type PublicHkr,
} from "@/lib/api/story-item-fields";

export type PublicApiItem = ApiItemCommonFields<PublicHkr> & ApiItemEventFields;

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
