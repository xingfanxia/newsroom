import type { Story } from "@/lib/types";

export type AgentApiItem = {
  id: string;
  title: string;
  summary: string;
  publisher: string;
  source_id: string;
  source_group: string | null;
  source_kind: string;
  tier: Story["tier"];
  importance: number;
  hkr: Story["hkr"] | null;
  tags: string[];
  url: string;
  published_at: string;
  has_commentary: boolean;
  cross_source_count: number | null;
  cluster_id: number | null;
  coverage: number | null;
  canonical_title: string | null;
  first_seen_at: string | null;
  latest_member_at: string | null;
  still_developing: boolean | null;
};

/**
 * Shared flat item contract for bearer-gated /api/v1/feed and /api/v1/search.
 * Agents should be able to parse either endpoint with one schema.
 */
export function toAgentApiItem(
  story: Story,
  locale: "zh" | "en",
): AgentApiItem {
  const isEvent = (story.coverage ?? 0) > 1 && story.clusterId != null;
  const canonical = isEvent
    ? (locale === "zh" ? story.canonicalTitleZh : story.canonicalTitleEn) ?? null
    : null;

  return {
    id: story.id,
    title: story.title,
    summary: story.summary,
    publisher: story.source.publisher,
    source_id: story.sourceId,
    source_group: story.source.groupCode ?? null,
    source_kind: story.source.kindCode,
    tier: story.tier,
    importance: story.importance,
    hkr: story.hkr ?? null,
    tags: story.tags,
    url: story.url,
    published_at: story.publishedAt,
    has_commentary: Boolean(story.editorNote || story.editorAnalysis),
    cross_source_count: story.crossSourceCount ?? story.coverage ?? null,
    cluster_id: story.clusterId ?? null,
    coverage: story.coverage ?? null,
    canonical_title: canonical,
    first_seen_at: story.firstSeenAt ?? null,
    latest_member_at: story.latestMemberAt ?? null,
    still_developing: story.stillDeveloping ?? null,
  };
}
