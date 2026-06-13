import { pickLocalizedText, pickSameLocaleText } from "@/lib/items/localized";
import { flattenItemTags } from "@/lib/items/tags";
import { isHighlightItemTier, type AppLocale, type Story } from "@/lib/types";

export type StoryRow = {
  id: number;
  title: string;
  titleZh: string | null;
  titleEn: string | null;
  summaryZh: string | null;
  summaryEn: string | null;
  editorNoteZh: string | null;
  editorNoteEn: string | null;
  editorAnalysisZh: string | null;
  editorAnalysisEn: string | null;
  reasoning: string | null;
  reasoningZh: string | null;
  reasoningEn: string | null;
  hkr: unknown;
  url: string;
  importance: number | null;
  tier: string | null;
  tags: unknown;
  publishedAt: Date;
  sourceId: string;
  sourceNameZh: string;
  sourceNameEn: string;
  sourceLocale: string | null;
  sourceKind: string;
  sourceGroup: string;
  clusterId?: number | null;
  clusterMemberCount?: number | null;
  clusterFirstSeenAt?: Date | null;
  clusterLatestMemberAt?: Date | null;
  clusterCanonicalTitleZh?: string | null;
  clusterCanonicalTitleEn?: string | null;
  clusterEditorNoteZh?: string | null;
  clusterEditorNoteEn?: string | null;
  clusterEditorAnalysisZh?: string | null;
  clusterEditorAnalysisEn?: string | null;
  clusterImportance?: number | null;
  clusterEventTier?: string | null;
  clusterHkr?: unknown;
};

export type StoryMapperOptions = {
  locale: AppLocale;
  tagLimit: number;
  includeSourceGroup?: boolean;
  nowMs?: number;
  startOfTodayMs?: number;
  hotWindowMs?: number;
};

export function toStory(
  row: StoryRow,
  options: StoryMapperOptions,
): Story {
  const { locale } = options;
  const publisher =
    pickSameLocaleText(locale, {
      en: row.sourceNameEn,
      zh: row.sourceNameZh,
    }) ?? row.sourceId;
  const title =
    pickSameLocaleText(locale, {
      en: row.clusterCanonicalTitleEn,
      zh: row.clusterCanonicalTitleZh,
    }) ??
    pickLocalizedText(locale, {
      en: row.titleEn,
      zh: row.titleZh,
      fallback: row.title,
    })!;
  const editorNote =
    pickLocalizedText(locale, {
      en: row.clusterEditorNoteEn,
      zh: row.clusterEditorNoteZh,
    }) ??
    pickLocalizedText(locale, {
      en: row.editorNoteEn,
      zh: row.editorNoteZh,
    });
  const editorAnalysis =
    pickLocalizedText(locale, {
      en: row.clusterEditorAnalysisEn,
      zh: row.clusterEditorAnalysisZh,
    }) ??
    pickLocalizedText(locale, {
      en: row.editorAnalysisEn,
      zh: row.editorAnalysisZh,
    });
  const effectiveImportance = row.clusterImportance ?? row.importance ?? 0;
  const effectiveTier = (row.clusterEventTier ?? row.tier ?? "all") as Story["tier"];
  const effectiveHkr =
    (row.clusterHkr as Story["hkr"] | null | undefined) ??
    (row.hkr as Story["hkr"] | null | undefined);
  const coverage =
    row.clusterMemberCount && row.clusterMemberCount > 1
      ? row.clusterMemberCount
      : undefined;

  return {
    id: String(row.id),
    sourceId: row.sourceId,
    source: {
      publisher,
      kindCode: row.sourceKind as Story["source"]["kindCode"],
      localeCode: (row.sourceLocale ?? "multi") as Story["source"]["localeCode"],
      groupCode: options.includeSourceGroup
        ? (row.sourceGroup as Story["source"]["groupCode"])
        : undefined,
    },
    featured: isHighlightItemTier(effectiveTier),
    title,
    summary: pickLocalizedText(locale, {
      en: row.summaryEn,
      zh: row.summaryZh,
    }) ?? "",
    tags: flattenItemTags(row.tags, options.tagLimit),
    importance: effectiveImportance,
    tier: effectiveTier,
    publishedAt: row.publishedAt.toISOString(),
    url: row.url,
    crossSourceCount: coverage ? coverage - 1 : undefined,
    locale: (row.sourceLocale ?? "multi") as Story["locale"],
    editorNote: editorNote ?? undefined,
    editorAnalysis: editorAnalysis ?? undefined,
    reasoning: pickLocalizedText(locale, {
      en: row.reasoningEn,
      zh: row.reasoningZh,
      fallback: row.reasoning,
    }) ?? undefined,
    hkr: effectiveHkr ?? undefined,
    clusterId: row.clusterId ?? undefined,
    coverage,
    firstSeenAt: row.clusterFirstSeenAt?.toISOString(),
    latestMemberAt: row.clusterLatestMemberAt?.toISOString(),
    canonicalTitleZh: row.clusterCanonicalTitleZh ?? undefined,
    canonicalTitleEn: row.clusterCanonicalTitleEn ?? undefined,
    stillDeveloping: stillDeveloping(row, options) || undefined,
  };
}

function stillDeveloping(
  row: StoryRow,
  options: StoryMapperOptions,
): boolean {
  if (
    options.nowMs == null ||
    options.startOfTodayMs == null ||
    options.hotWindowMs == null
  ) {
    return false;
  }
  const firstSeenMs = row.clusterFirstSeenAt?.getTime();
  const latestMemberMs = row.clusterLatestMemberAt?.getTime();
  return (
    firstSeenMs !== undefined &&
    latestMemberMs !== undefined &&
    firstSeenMs < options.startOfTodayMs &&
    latestMemberMs > options.nowMs - options.hotWindowMs
  );
}
