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

export type SavedAgentApiItem = AgentApiItem & {
  saved_at: string;
  collection_id: number | null;
};

/**
 * Shared flat item contract for bearer-gated REST and MCP item lists.
 * Agents should be able to parse feed/search/saved rows with one schema.
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

export function toSavedAgentApiItem(
  story: Story & { savedAt: string; collectionId: number | null },
  locale: "zh" | "en",
): SavedAgentApiItem {
  return {
    ...toAgentApiItem(story, locale),
    saved_at: story.savedAt,
    collection_id: story.collectionId,
  };
}
