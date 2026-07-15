import { unstable_cache } from "next/cache";
import {
  deriveDayCounts,
  derivePodcastChannels,
  deriveXHandles,
} from "@/lib/public-content/derive";
import {
  publicPageItemDetail,
  readPublicPageSnapshot,
} from "@/lib/public-content/page-data";
import {
  getPublicDailyByDate,
  listPublicDailyColumns,
} from "@/lib/public-content/public-dailies";
import { queryPublicFeed } from "@/lib/public-content/query";
import { feedPageLimitForDate } from "@/lib/feed/page-query";
import type { PodcastTier } from "@/lib/feed/podcast-filters";
import {
  sourcePresetToFeedFilter,
  type SourcePreset,
} from "@/lib/feed/source-presets";
import { shellChromeDataFromSnapshot } from "@/lib/shell/chrome-data";
import type { AppLocale } from "@/lib/types";

export const PUBLIC_PAGE_MODELS_CACHE_TAG = "public-page-models";
export const PUBLIC_PAGE_MODELS_CACHE_TTL = 600;

const cacheOptions = {
  revalidate: PUBLIC_PAGE_MODELS_CACHE_TTL,
  tags: [PUBLIC_PAGE_MODELS_CACHE_TAG],
};

const readAllPageModel = unstable_cache(
  async (input: {
    locale: AppLocale;
    sourceId?: string;
    sourcePreset: SourcePreset;
    activeDate?: string;
    offset: number;
  }) => {
    const { state, nowMs } = await readPublicPageSnapshot();
    const sourceFilter = input.sourceId
      ? { sourceId: input.sourceId }
      : sourcePresetToFeedFilter(input.sourcePreset);
    return {
      stories: queryPublicFeed(
        state,
        {
          tier: "all",
          locale: input.locale,
          limit: feedPageLimitForDate(input.activeDate),
          offset: input.offset,
          date: input.activeDate,
          recencyFloorDays:
            input.sourceId || input.sourcePreset !== "all" ? undefined : 30,
          ...sourceFilter,
        },
        { nowMs },
      ).items,
      chrome: shellChromeDataFromSnapshot(state, nowMs, { pulse: true }),
      days: deriveDayCounts(state, 60, {}, nowMs),
    };
  },
  ["public-all-page-model:v1"],
  cacheOptions,
);

const readCuratedPageModel = unstable_cache(
  async (input: {
    locale: AppLocale;
    sourceId?: string;
    activeDate?: string;
    offset: number;
  }) => {
    const { state, nowMs } = await readPublicPageSnapshot();
    return {
      stories: queryPublicFeed(
        state,
        {
          tier: "all",
          locale: input.locale,
          limit: feedPageLimitForDate(input.activeDate),
          offset: input.offset,
          date: input.activeDate,
          curatedOnly: true,
          sourceId: input.sourceId,
          recencyFloorDays: input.sourceId ? undefined : 30,
        },
        { nowMs },
      ).items,
      chrome: shellChromeDataFromSnapshot(state, nowMs, { pulse: true }),
      days: deriveDayCounts(state, 60, { curatedOnly: true }, nowMs),
    };
  },
  ["public-curated-page-model:v1"],
  cacheOptions,
);

const readSourcesPageModel = unstable_cache(
  async () => {
    const { state, nowMs } = await readPublicPageSnapshot();
    return {
      live: state.sources,
      chrome: shellChromeDataFromSnapshot(state, nowMs, { pulse: true }),
    };
  },
  ["public-sources-page-model:v1"],
  cacheOptions,
);

const readPodcastsPageModel = unstable_cache(
  async (input: {
    locale: AppLocale;
    source?: string;
    tier: PodcastTier;
  }) => {
    const { state, nowMs } = await readPublicPageSnapshot();
    const channels = derivePodcastChannels(state);
    const activeChannel =
      input.source && channels.some(({ id }) => id === input.source)
        ? input.source
        : null;
    return {
      channels,
      activeChannel,
      stories: queryPublicFeed(
        state,
        {
          tier: input.tier,
          locale: input.locale,
          sourceGroup: activeChannel ? undefined : "podcast",
          sourceId: activeChannel ?? undefined,
          includeSourceGroup: true,
          limit: activeChannel ? 300 : 120,
        },
        { nowMs },
      ).items,
      chrome: shellChromeDataFromSnapshot(state, nowMs, { pulse: true }),
    };
  },
  ["public-podcasts-page-model:v1"],
  cacheOptions,
);

const readPodcastDetailPageModel = unstable_cache(
  async (input: { locale: AppLocale; id: number }) => {
    const { state, nowMs } = await readPublicPageSnapshot();
    return {
      detail: publicPageItemDetail(state, input.id, input.locale, nowMs),
      chrome: shellChromeDataFromSnapshot(state, nowMs),
    };
  },
  ["public-podcast-detail-page-model:v1"],
  cacheOptions,
);

const readXMonitorPageModel = unstable_cache(
  async (input: { locale: AppLocale; handle?: string }) => {
    const { state, nowMs } = await readPublicPageSnapshot();
    const handles = deriveXHandles(state, nowMs);
    const activeIsValid = input.handle
      ? handles.some(({ id }) => id === input.handle)
      : false;
    return {
      handles,
      activeIsValid,
      stories: queryPublicFeed(
        state,
        {
          tier: "all",
          locale: input.locale,
          sourceId: activeIsValid ? input.handle : undefined,
          sourceKind: activeIsValid ? undefined : "x-api",
          limit: activeIsValid ? 200 : 80,
        },
        { nowMs },
      ).items,
      chrome: shellChromeDataFromSnapshot(state, nowMs, { pulse: true }),
    };
  },
  ["public-x-monitor-page-model:v1"],
  cacheOptions,
);

const readDailyIndexPageModel = unstable_cache(
  async (input: { locale: AppLocale; offset: number; take: number }) => {
    const { state, nowMs } = await readPublicPageSnapshot();
    return {
      rows:
        input.locale === "zh"
          ? listPublicDailyColumns(state, {
              locale: "zh",
              take: input.take,
              offset: input.offset,
            })
          : [],
      chrome: shellChromeDataFromSnapshot(state, nowMs, { pulse: true }),
    };
  },
  ["public-daily-index-page-model:v1"],
  cacheOptions,
);

const readDailyDatePageModel = unstable_cache(
  async (input: { locale: AppLocale; date: string }) => {
    const { state, nowMs } = await readPublicPageSnapshot();
    return {
      row: getPublicDailyByDate(state, input.date, input.locale),
      chrome: shellChromeDataFromSnapshot(state, nowMs, { pulse: true }),
    };
  },
  ["public-daily-date-page-model:v1"],
  cacheOptions,
);

const readAgentsPageModel = unstable_cache(
  async () => {
    const { state, nowMs } = await readPublicPageSnapshot();
    return {
      chrome: shellChromeDataFromSnapshot(state, nowMs, { pulse: true }),
    };
  },
  ["public-agents-page-model:v1"],
  cacheOptions,
);

export {
  readAgentsPageModel,
  readAllPageModel,
  readCuratedPageModel,
  readDailyDatePageModel,
  readDailyIndexPageModel,
  readPodcastDetailPageModel,
  readPodcastsPageModel,
  readSourcesPageModel,
  readXMonitorPageModel,
};
