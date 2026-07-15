import { unstable_cache } from "next/cache";
import { mockStories } from "@/lib/mock/stories";
import {
  deriveDayCounts,
  deriveRecentTickerItems,
  deriveTopTopics,
} from "@/lib/public-content/derive";
import {
  publicPolicySummary,
  readPublicPageSnapshot,
} from "@/lib/public-content/page-data";
import { queryPublicFeed } from "@/lib/public-content/query";
import { feedPageLimitForDate } from "@/lib/feed/page-query";
import {
  DEFAULT_HOME_TIER,
  type HomeTier,
  type HomeView,
} from "@/lib/feed/home-filters";
import {
  sourcePresetToFeedFilter,
  type SourcePreset,
} from "@/lib/feed/source-presets";
import { shellChromeDataFromSnapshot } from "@/lib/shell/chrome-data";
import type { AppLocale, Story } from "@/lib/types";

export const PUBLIC_HOME_MODEL_CACHE_TAG = "public-home-model";
export const PUBLIC_HOME_MODEL_CACHE_TTL = 600;

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

async function buildPublicHomePageModel(
  input: PublicHomePageModelInput,
): Promise<PublicHomePageModel> {
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
  const { state, nowMs } = await readPublicPageSnapshot();
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

const readCachedModel = unstable_cache(
  buildPublicHomePageModel,
  ["public-home-model:v1"],
  {
    revalidate: PUBLIC_HOME_MODEL_CACHE_TTL,
    tags: [PUBLIC_HOME_MODEL_CACHE_TAG],
  },
);

/**
 * Cache only the compact, public homepage view model (~100-200 KiB), never the
 * ~95 MiB canonical snapshot. The ten-minute SWR is intentionally TTL-driven:
 * users keep receiving the prior model while one background refresh rebuilds it.
 */
export function readCachedPublicHomePageModel(
  input: PublicHomePageModelInput,
): Promise<PublicHomePageModel> {
  return readCachedModel(input);
}
