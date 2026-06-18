import type { AppLocale, SourceGroup, SourceKind, Story } from "@/lib/types";

export type PublicHkr = { h: boolean; k: boolean; r: boolean };

export type ApiItemCommonFields<Hkr> = {
  id: string;
  title: string;
  summary: string;
  publisher: string;
  source_id: string;
  source_group: SourceGroup | null;
  source_kind: SourceKind;
  tier: Story["tier"];
  importance: number;
  hkr: Hkr | null;
  tags: string[];
  url: string;
  published_at: string;
  has_commentary: boolean;
};

export type ApiItemEventFields = {
  cluster_id: number | null;
  coverage: number | null;
  canonical_title: string | null;
  first_seen_at: string | null;
  latest_member_at: string | null;
};

export function toPublicHkr(
  hkr: Story["hkr"] | null | undefined,
): PublicHkr | null {
  if (!hkr) return null;
  return { h: Boolean(hkr.h), k: Boolean(hkr.k), r: Boolean(hkr.r) };
}

export function toApiItemCommonFields<Hkr>(
  story: Story,
  hkr: Hkr | null,
): ApiItemCommonFields<Hkr> {
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
    hkr,
    tags: story.tags,
    url: story.url,
    published_at: story.publishedAt,
    has_commentary: Boolean(story.editorNote || story.editorAnalysis),
  };
}

export function toApiItemEventFields(
  story: Story,
  locale: AppLocale,
): ApiItemEventFields {
  const isEvent = (story.coverage ?? 0) > 1 && story.clusterId != null;
  const canonicalTitle = isEvent
    ? (locale === "zh" ? story.canonicalTitleZh : story.canonicalTitleEn) ??
      null
    : null;

  return {
    cluster_id: story.clusterId ?? null,
    coverage: story.coverage ?? null,
    canonical_title: canonicalTitle,
    first_seen_at: story.firstSeenAt ?? null,
    latest_member_at: story.latestMemberAt ?? null,
  };
}
