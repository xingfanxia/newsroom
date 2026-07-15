import { pickLocalizedText, pickSameLocaleText } from "@/lib/items/localized";
import { flattenItemTags } from "@/lib/items/tags";
import { deriveWhyFeatured } from "@/lib/public-content/public-rubric";
import {
  canonicalStateSchema,
  type CanonicalPublicState,
} from "@/lib/public-content/contracts";
import {
  isHighlightItemTier,
  type AppLocale,
  type Story,
} from "@/lib/types";

export type PublicItem = CanonicalPublicState["items"][number];
export type PublicEvent = CanonicalPublicState["events"][number];
export type PublicSource = CanonicalPublicState["sources"][number];

export type PublicStateIndex = {
  state: CanonicalPublicState;
  itemsById: ReadonlyMap<number, PublicItem>;
  eventsById: ReadonlyMap<number, PublicEvent>;
  sourcesById: ReadonlyMap<string, PublicSource>;
};

export function createPublicStateIndex(value: unknown): PublicStateIndex {
  const state = canonicalStateSchema.parse(value);
  return {
    state,
    itemsById: new Map(state.items.map((item) => [item.id, item])),
    eventsById: new Map(state.events.map((event) => [event.id, event])),
    sourcesById: new Map(state.sources.map((source) => [source.id, source])),
  };
}

export function publicStoryFromItem(
  index: PublicStateIndex,
  item: PublicItem,
  options: {
    locale: AppLocale;
    includeSourceGroup?: boolean;
    nowMs: number;
    hotWindowHours?: number;
    tagLimit?: number;
  },
): Story {
  const source = index.sourcesById.get(item.sourceId);
  if (!source) throw new Error(`missing public source: ${item.sourceId}`);
  const event = item.eventId === null ? undefined : index.eventsById.get(item.eventId);
  if (item.eventId !== null && !event) {
    throw new Error(`missing public event: ${item.eventId}`);
  }

  const effectiveTier = event?.tier ?? item.tier;
  const effectiveImportance = event?.importance ?? item.importance;
  const effectiveHkr = event?.hkr ?? item.hkr;
  const coverage = event && event.coverage > 1 ? event.coverage : undefined;
  const startOfTodayMs = startOfUtcDay(options.nowMs);
  const hotWindowMs = (options.hotWindowHours ?? 24) * 3_600_000;

  const publisher =
    pickSameLocaleText(options.locale, source.name) ?? source.id;
  const title =
    (event
      ? pickSameLocaleText(options.locale, event.canonicalTitle)
      : null) ??
    pickLocalizedText(options.locale, {
      en: item.title.en,
      zh: item.title.zh,
      fallback: item.title.raw,
    })!;
  const editorNote =
    (event ? pickLocalizedText(options.locale, event.editorNote) : null) ??
    pickLocalizedText(options.locale, item.editorNote);
  const editorAnalysis =
    (event ? pickLocalizedText(options.locale, event.editorAnalysis) : null) ??
    pickLocalizedText(options.locale, item.editorAnalysis);

  const story: Story = {
    id: String(item.id),
    sourceId: item.sourceId,
    source: {
      publisher,
      kindCode: source.kind,
      localeCode: source.locale,
      groupCode: options.includeSourceGroup ? source.group : undefined,
    },
    featured: isHighlightItemTier(effectiveTier),
    title,
    summary:
      pickLocalizedText(options.locale, {
        en: item.summary.en,
        zh: item.summary.zh,
      }) ?? "",
    tags: flattenItemTags(item.tags, options.tagLimit ?? 4),
    importance: effectiveImportance,
    tier: effectiveTier,
    publishedAt: item.publishedAt,
    url: item.url,
    crossSourceCount: coverage ? coverage - 1 : undefined,
    locale: source.locale,
    editorNote: editorNote ?? undefined,
    editorAnalysis: editorAnalysis ?? undefined,
    whyFeatured:
      deriveWhyFeatured({
        locale: options.locale,
        tier: effectiveTier,
        importance: effectiveImportance,
        hkr: effectiveHkr,
      }) ?? undefined,
    hkr: effectiveHkr ?? undefined,
    clusterId: event?.id,
    coverage,
    firstSeenAt: event?.firstSeenAt,
    latestMemberAt: event?.latestMemberAt ?? undefined,
    canonicalTitleZh: event?.canonicalTitle.zh ?? undefined,
    canonicalTitleEn: event?.canonicalTitle.en ?? undefined,
    stillDeveloping:
      event !== undefined &&
      event.latestMemberAt !== null &&
      Date.parse(event.firstSeenAt) < startOfTodayMs &&
      Date.parse(event.latestMemberAt) > options.nowMs - hotWindowMs
        ? true
        : undefined,
  };
  return story;
}

export function publicEventMembersFromIndex(
  index: PublicStateIndex,
  eventId: number,
  locale: AppLocale,
): NonNullable<Story["members"]> {
  const event = index.eventsById.get(eventId);
  if (!event) return [];

  return event.memberItemIds
    .map((itemId) => index.itemsById.get(itemId))
    .filter((item): item is PublicItem => item !== undefined)
    .sort(
      (left, right) =>
        right.importance - left.importance ||
        left.publishedAt.localeCompare(right.publishedAt),
    )
    .map((item) => {
      const source = index.sourcesById.get(item.sourceId);
      if (!source) throw new Error(`missing public source: ${item.sourceId}`);
      return {
        sourceId: item.sourceId,
        sourceName:
          pickSameLocaleText(locale, source.name) ?? source.id,
        title:
          pickLocalizedText(locale, {
            en: item.title.en,
            zh: item.title.zh,
            fallback: item.title.raw,
          })!,
        url: item.url,
        publishedAt: item.publishedAt,
        importance: item.importance,
      };
    });
}

export function startOfUtcDay(nowMs: number): number {
  return nowMs - (nowMs % 86_400_000);
}
