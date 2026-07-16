import { mockStories } from "@/lib/mock/stories";
import {
  deriveDayCounts,
  derivePodcastChannels,
  deriveRecentTickerItems,
  deriveTopTopics,
  deriveXHandles,
} from "@/lib/public-content/derive";
import {
  publicPageItemDetail,
  publicPolicySummary,
} from "@/lib/public-content/page-data";
import {
  getPublicDailyByDate,
  listPublicDailyColumns,
} from "@/lib/public-content/public-dailies";
import { queryPublicFeed } from "@/lib/public-content/query";
import { feedPageLimitForDate } from "@/lib/feed/page-query";
import {
  DEFAULT_HOME_TIER,
  type HomeTier,
  type HomeView,
} from "@/lib/feed/home-filters";
import type { PodcastTier } from "@/lib/feed/podcast-filters";
import {
  sourcePresetToFeedFilter,
  type SourcePreset,
} from "@/lib/feed/source-presets";
import { shellChromeDataFromSnapshot } from "@/lib/shell/chrome-data";
import type { CanonicalPublicState } from "@/lib/public-content/contracts";
import type { AppLocale, Story } from "@/lib/types";

export type PublicHomePageModelInput = {
  locale: AppLocale;
  tier: HomeTier;
  sourceId?: string;
  sourcePreset: SourcePreset;
  activeDate?: string;
  homeView: HomeView;
};

export type PublicHomePageModel = {
  stories: Story[];
  chrome: ReturnType<typeof shellChromeDataFromSnapshot>;
  topics: ReturnType<typeof deriveTopTopics>;
  policy: ReturnType<typeof publicPolicySummary>;
  tickerItems: ReturnType<typeof deriveRecentTickerItems>;
  days: ReturnType<typeof deriveDayCounts>;
};

export function buildPublicHomePageModelFromSnapshot(
  state: CanonicalPublicState,
  nowMs: number,
  input: PublicHomePageModelInput,
): PublicHomePageModel {
  const dailyHighlights =
    !input.activeDate &&
    !input.sourceId &&
    input.sourcePreset === "all" &&
    input.tier === DEFAULT_HOME_TIER &&
    input.homeView === "daily";
  const sourceFilter = input.sourceId
    ? { sourceId: input.sourceId }
    : sourcePresetToFeedFilter(input.sourcePreset);
  const recencyFloorDays =
    input.sourceId || input.sourcePreset !== "all"
      ? undefined
      : dailyHighlights
        ? 30
        : 7;
  let stories = queryPublicFeed(
    state,
    {
      tier: input.tier,
      locale: input.locale,
      limit: feedPageLimitForDate(input.activeDate, 120),
      date: input.activeDate,
      view: input.activeDate || dailyHighlights ? "archive" : "today",
      recencyFloorDays,
      ...(dailyHighlights
        ? { minImportance: 80, maxPerDay: 3, recentDayRescueDays: 3 }
        : {}),
      ...sourceFilter,
    },
    { nowMs },
  ).items;
  if (
    stories.length === 0 &&
    input.tier === DEFAULT_HOME_TIER &&
    input.sourcePreset === "all" &&
    !input.sourceId &&
    !input.activeDate &&
    state.items.length === 0
  ) {
    stories = mockStories;
  }
  return {
    stories,
    chrome: shellChromeDataFromSnapshot(state, nowMs, {
      pulse: true,
      signalRatio: "fromRadar",
    }),
    topics: deriveTopTopics(state, nowMs),
    policy: publicPolicySummary(state, nowMs),
    tickerItems: deriveRecentTickerItems(state, input.locale, nowMs),
    days: deriveDayCounts(state, 60, { tier: DEFAULT_HOME_TIER }, nowMs),
  };
}

export type AllPageModelInput = {
  locale: AppLocale;
  sourceId?: string;
  sourcePreset: SourcePreset;
  activeDate?: string;
  offset: number;
};

export function buildAllPageModel(
  state: CanonicalPublicState,
  nowMs: number,
  input: AllPageModelInput,
) {
  const sourceFilter = input.sourceId
    ? { sourceId: input.sourceId }
    : sourcePresetToFeedFilter(input.sourcePreset);
  return {
    stories: queryPublicFeed(state, {
      tier: "all",
      locale: input.locale,
      limit: feedPageLimitForDate(input.activeDate),
      offset: input.offset,
      date: input.activeDate,
      recencyFloorDays:
        input.sourceId || input.sourcePreset !== "all" ? undefined : 30,
      ...sourceFilter,
    }, { nowMs }).items,
    chrome: shellChromeDataFromSnapshot(state, nowMs, { pulse: true }),
    days: deriveDayCounts(state, 60, {}, nowMs),
  };
}

export type CuratedPageModelInput = {
  locale: AppLocale;
  sourceId?: string;
  activeDate?: string;
  offset: number;
};

export function buildCuratedPageModel(
  state: CanonicalPublicState,
  nowMs: number,
  input: CuratedPageModelInput,
) {
  return {
    stories: queryPublicFeed(state, {
      tier: "all",
      locale: input.locale,
      limit: feedPageLimitForDate(input.activeDate),
      offset: input.offset,
      date: input.activeDate,
      curatedOnly: true,
      sourceId: input.sourceId,
      recencyFloorDays: input.sourceId ? undefined : 30,
    }, { nowMs }).items,
    chrome: shellChromeDataFromSnapshot(state, nowMs, { pulse: true }),
    days: deriveDayCounts(state, 60, { curatedOnly: true }, nowMs),
  };
}

export function buildSourcesPageModel(
  state: CanonicalPublicState,
  nowMs: number,
) {
  return {
    live: state.sources,
    chrome: shellChromeDataFromSnapshot(state, nowMs, { pulse: true }),
  };
}

export type PodcastsPageModelInput = {
  locale: AppLocale;
  source?: string;
  tier: PodcastTier;
};

export function buildPodcastsPageModel(
  state: CanonicalPublicState,
  nowMs: number,
  input: PodcastsPageModelInput,
) {
  const channels = derivePodcastChannels(state);
  const activeChannel =
    input.source && channels.some(({ id }) => id === input.source)
      ? input.source
      : null;
  return {
    channels,
    activeChannel,
    stories: queryPublicFeed(state, {
      tier: input.tier,
      locale: input.locale,
      sourceGroup: activeChannel ? undefined : "podcast",
      sourceId: activeChannel ?? undefined,
      includeSourceGroup: true,
      limit: activeChannel ? 300 : 120,
    }, { nowMs }).items,
    chrome: shellChromeDataFromSnapshot(state, nowMs, { pulse: true }),
  };
}

export function buildPodcastDetailPageModel(
  state: CanonicalPublicState,
  nowMs: number,
  input: { locale: AppLocale; id: number },
  resolvedBodyMd: string | null = null,
) {
  return {
    detail: publicPageItemDetail(
      state,
      input.id,
      input.locale,
      nowMs,
      resolvedBodyMd,
    ),
    chrome: shellChromeDataFromSnapshot(state, nowMs),
  };
}

export type XMonitorPageModelInput = { locale: AppLocale; handle?: string };

export function buildXMonitorPageModel(
  state: CanonicalPublicState,
  nowMs: number,
  input: XMonitorPageModelInput,
) {
  const handles = deriveXHandles(state, nowMs);
  const activeIsValid = input.handle
    ? handles.some(({ id }) => id === input.handle)
    : false;
  return {
    handles,
    activeIsValid,
    stories: queryPublicFeed(state, {
      tier: "all",
      locale: input.locale,
      sourceId: activeIsValid ? input.handle : undefined,
      sourceKind: activeIsValid ? undefined : "x-api",
      limit: activeIsValid ? 200 : 80,
    }, { nowMs }).items,
    chrome: shellChromeDataFromSnapshot(state, nowMs, { pulse: true }),
  };
}

export function buildDailyIndexPageModel(
  state: CanonicalPublicState,
  nowMs: number,
  input: { locale: AppLocale; offset: number; take: number },
) {
  return {
    rows: input.locale === "zh"
      ? listPublicDailyColumns(state, {
          locale: "zh",
          take: input.take,
          offset: input.offset,
        })
      : [],
    chrome: shellChromeDataFromSnapshot(state, nowMs, { pulse: true }),
  };
}

export function buildDailyDatePageModel(
  state: CanonicalPublicState,
  nowMs: number,
  input: { locale: AppLocale; date: string },
) {
  return {
    row: getPublicDailyByDate(state, input.date, input.locale),
    chrome: shellChromeDataFromSnapshot(state, nowMs, { pulse: true }),
  };
}

export function buildAgentsPageModel(
  state: CanonicalPublicState,
  nowMs: number,
) {
  return { chrome: shellChromeDataFromSnapshot(state, nowMs, { pulse: true }) };
}
