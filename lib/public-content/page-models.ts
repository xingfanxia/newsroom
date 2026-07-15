import { unstable_cache } from "next/cache";
import { readPublicPageSnapshot } from "@/lib/public-content/page-data";
import {
  materializedPageLogicalName,
  readMaterializedPageModel,
} from "@/lib/public-content/materialized-artifact";
import {
  buildAgentsPageModel,
  buildAllPageModel,
  buildCuratedPageModel,
  buildDailyDatePageModel,
  buildDailyIndexPageModel,
  buildPodcastDetailPageModel,
  buildPodcastsPageModel,
  buildSourcesPageModel,
  buildXMonitorPageModel,
  type AllPageModelInput,
  type CuratedPageModelInput,
  type PodcastsPageModelInput,
  type XMonitorPageModelInput,
} from "@/lib/public-content/page-model-builders";
import { DEFAULT_PODCAST_TIER } from "@/lib/feed/podcast-filters";
import type { AppLocale } from "@/lib/types";

export const PUBLIC_PAGE_MODELS_CACHE_TAG = "public-page-models";
export const PUBLIC_PAGE_MODELS_CACHE_TTL = 600;

const cacheOptions = {
  revalidate: PUBLIC_PAGE_MODELS_CACHE_TTL,
  tags: [PUBLIC_PAGE_MODELS_CACHE_TAG],
};

const readCachedAllPageModel = unstable_cache(
  async (input: AllPageModelInput) => {
    const { state, nowMs } = await readPublicPageSnapshot();
    return buildAllPageModel(state, nowMs, input);
  },
  ["public-all-page-model:v1"],
  cacheOptions,
);

const readCachedCuratedPageModel = unstable_cache(
  async (input: CuratedPageModelInput) => {
    const { state, nowMs } = await readPublicPageSnapshot();
    return buildCuratedPageModel(state, nowMs, input);
  },
  ["public-curated-page-model:v1"],
  cacheOptions,
);

const readCachedSourcesPageModel = unstable_cache(
  async () => {
    const { state, nowMs } = await readPublicPageSnapshot();
    return buildSourcesPageModel(state, nowMs);
  },
  ["public-sources-page-model:v1"],
  cacheOptions,
);

const readCachedPodcastsPageModel = unstable_cache(
  async (input: PodcastsPageModelInput) => {
    const { state, nowMs } = await readPublicPageSnapshot();
    return buildPodcastsPageModel(state, nowMs, input);
  },
  ["public-podcasts-page-model:v1"],
  cacheOptions,
);

const readCachedPodcastDetailPageModel = unstable_cache(
  async (input: { locale: AppLocale; id: number }) => {
    const { state, nowMs } = await readPublicPageSnapshot();
    return buildPodcastDetailPageModel(state, nowMs, input);
  },
  ["public-podcast-detail-page-model:v1"],
  cacheOptions,
);

const readCachedXMonitorPageModel = unstable_cache(
  async (input: XMonitorPageModelInput) => {
    const { state, nowMs } = await readPublicPageSnapshot();
    return buildXMonitorPageModel(state, nowMs, input);
  },
  ["public-x-monitor-page-model:v1"],
  cacheOptions,
);

const readCachedDailyIndexPageModel = unstable_cache(
  async (input: { locale: AppLocale; offset: number; take: number }) => {
    const { state, nowMs } = await readPublicPageSnapshot();
    return buildDailyIndexPageModel(state, nowMs, input);
  },
  ["public-daily-index-page-model:v1"],
  cacheOptions,
);

const readCachedDailyDatePageModel = unstable_cache(
  async (input: { locale: AppLocale; date: string }) => {
    const { state, nowMs } = await readPublicPageSnapshot();
    return buildDailyDatePageModel(state, nowMs, input);
  },
  ["public-daily-date-page-model:v1"],
  cacheOptions,
);

const readCachedAgentsPageModel = unstable_cache(
  async () => {
    const { state, nowMs } = await readPublicPageSnapshot();
    return buildAgentsPageModel(state, nowMs);
  },
  ["public-agents-page-model:v1"],
  cacheOptions,
);

type AllPageModel = ReturnType<typeof buildAllPageModel>;
type CuratedPageModel = ReturnType<typeof buildCuratedPageModel>;
type SourcesPageModel = ReturnType<typeof buildSourcesPageModel>;
type PodcastsPageModel = ReturnType<typeof buildPodcastsPageModel>;
type PodcastDetailPageModel = ReturnType<typeof buildPodcastDetailPageModel>;
type XMonitorPageModel = ReturnType<typeof buildXMonitorPageModel>;
type DailyIndexPageModel = ReturnType<typeof buildDailyIndexPageModel>;
type AgentsPageModel = ReturnType<typeof buildAgentsPageModel>;

export async function readAllPageModel(input: AllPageModelInput): Promise<AllPageModel> {
  if (!input.sourceId && input.sourcePreset === "all" && !input.activeDate && input.offset === 0) {
    const published = await readMaterializedPageModel<AllPageModel>(
      materializedPageLogicalName.all(input.locale),
    );
    if (published) return published;
  }
  return readCachedAllPageModel(input);
}

export async function readCuratedPageModel(
  input: CuratedPageModelInput,
): Promise<CuratedPageModel> {
  if (!input.sourceId && !input.activeDate && input.offset === 0) {
    const published = await readMaterializedPageModel<CuratedPageModel>(
      materializedPageLogicalName.curated(input.locale),
    );
    if (published) return published;
  }
  return readCachedCuratedPageModel(input);
}

export async function readSourcesPageModel(): Promise<SourcesPageModel> {
  const published = await readMaterializedPageModel<SourcesPageModel>(
    materializedPageLogicalName.sources,
  );
  return published ?? readCachedSourcesPageModel();
}

export async function readPodcastsPageModel(
  input: PodcastsPageModelInput,
): Promise<PodcastsPageModel> {
  if (!input.source && input.tier === DEFAULT_PODCAST_TIER) {
    const published = await readMaterializedPageModel<PodcastsPageModel>(
      materializedPageLogicalName.podcasts(input.locale),
    );
    if (published) return published;
  }
  return readCachedPodcastsPageModel(input);
}

type PublishedPodcastDetailModel = {
  detailByLocale: Record<AppLocale, NonNullable<PodcastDetailPageModel["detail"]>>;
  chrome: PodcastDetailPageModel["chrome"];
};

export async function readPodcastDetailPageModel(input: {
  locale: AppLocale;
  id: number;
}): Promise<PodcastDetailPageModel> {
  const published = await readMaterializedPageModel<PublishedPodcastDetailModel>(
    materializedPageLogicalName.podcastDetail(input.id),
  );
  if (published) {
    return { detail: published.detailByLocale[input.locale], chrome: published.chrome };
  }
  return readCachedPodcastDetailPageModel(input);
}

export async function readXMonitorPageModel(
  input: XMonitorPageModelInput,
): Promise<XMonitorPageModel> {
  if (!input.handle) {
    const published = await readMaterializedPageModel<XMonitorPageModel>(
      materializedPageLogicalName.xMonitor(input.locale),
    );
    if (published) return published;
  }
  return readCachedXMonitorPageModel(input);
}

export async function readDailyIndexPageModel(input: {
  locale: AppLocale;
  offset: number;
  take: number;
}): Promise<DailyIndexPageModel> {
  const published = await readMaterializedPageModel<DailyIndexPageModel>(
    materializedPageLogicalName.daily(input.locale),
  );
  if (published) {
    return {
      rows: published.rows.slice(input.offset, input.offset + input.take),
      chrome: published.chrome,
    };
  }
  return readCachedDailyIndexPageModel(input);
}

export async function readDailyDatePageModel(input: {
  locale: AppLocale;
  date: string;
}): Promise<ReturnType<typeof buildDailyDatePageModel>> {
  const published = await readMaterializedPageModel<DailyIndexPageModel>(
    materializedPageLogicalName.daily(input.locale),
  );
  if (published) {
    return {
      row: published.rows.find(({ date }) => date === input.date) ?? null,
      chrome: published.chrome,
    };
  }
  return readCachedDailyDatePageModel(input);
}

export async function readAgentsPageModel(): Promise<AgentsPageModel> {
  const published = await readMaterializedPageModel<AgentsPageModel>(
    materializedPageLogicalName.agents,
  );
  return published ?? readCachedAgentsPageModel();
}

export {
  buildAgentsPageModel,
  buildAllPageModel,
  buildCuratedPageModel,
  buildDailyDatePageModel,
  buildDailyIndexPageModel,
  buildPodcastDetailPageModel,
  buildPodcastsPageModel,
  buildSourcesPageModel,
  buildXMonitorPageModel,
  type AllPageModelInput,
  type CuratedPageModelInput,
  type PodcastsPageModelInput,
  type XMonitorPageModelInput,
};
