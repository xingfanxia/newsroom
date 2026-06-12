import type { Story } from "@/lib/types";
import {
  toApiItemCommonFields,
  toApiItemEventFields,
  type ApiItemCommonFields,
  type ApiItemEventFields,
} from "@/lib/api/story-item-fields";

export type AgentApiItem = ApiItemCommonFields<Story["hkr"]> & {
  cross_source_count: number | null;
  still_developing: boolean | null;
} & ApiItemEventFields;

/**
 * Shared flat item contract for bearer-gated /api/v1/feed and /api/v1/search.
 * Agents should be able to parse either endpoint with one schema.
 */
export function toAgentApiItem(
  story: Story,
  locale: "zh" | "en",
): AgentApiItem {
  return {
    ...toApiItemCommonFields(story, story.hkr ?? null),
    cross_source_count: story.crossSourceCount ?? story.coverage ?? null,
    ...toApiItemEventFields(story, locale),
    still_developing: story.stillDeveloping ?? null,
  };
}
