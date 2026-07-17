import { unstable_cache } from "next/cache";
import {
  readDirectPublicFeedStories,
  readDirectPublicItem,
  supportsDirectPublicRouteReads,
} from "@/lib/public-content/direct-route-read";
import {
  materializedPageLogicalName,
  readScopedMaterializedPageModel,
} from "@/lib/public-content/materialized-artifact";
import {
  activePodcastChannel,
  allPageFeedQuery,
  buildAgentsPageModel,
  buildAllPageModel,
  buildCuratedPageModel,
  buildDailyDatePageModel,
  buildDailyIndexPageModel,
  buildPodcastDetailPageModel,
  buildPodcastsPageModel,
  buildSourcesPageModel,
  buildXMonitorPageModel,
  curatedPageFeedQuery,
  isActiveXHandle,
  podcastsPageFeedQuery,
  xMonitorPageFeedQuery,
  type AllPageModelInput,
  type CuratedPageModelInput,
  type PodcastsPageModelInput,
  type XMonitorPageModelInput,
} from "@/lib/public-content/page-model-builders";
import { publicSnapshotReader } from "@/lib/public-content/reader";
import {
  parsePublicItemBodyShardValue,
  publicItemBodyShardLogicalName,
} from "@/lib/public-content/contracts";
import { publicPageItemDetailFromIndex } from "@/lib/public-content/page-data";
import type { PublicReleaseReadScope } from "@/lib/public-content/reader/types";
import { DEFAULT_PODCAST_TIER } from "@/lib/feed/podcast-filters";
import type { AppLocale } from "@/lib/types";

const cacheOptions = {
  revalidate: 600,
  tags: ["public-page-models"],
};

type AllPageModel = ReturnType<typeof buildAllPageModel>;
type CuratedPageModel = ReturnType<typeof buildCuratedPageModel>;
type SourcesPageModel = ReturnType<typeof buildSourcesPageModel>;
type PodcastsPageModel = ReturnType<typeof buildPodcastsPageModel>;
type PodcastDetailPageModel = ReturnType<typeof buildPodcastDetailPageModel>;
type XMonitorPageModel = ReturnType<typeof buildXMonitorPageModel>;
type DailyIndexPageModel = ReturnType<typeof buildDailyIndexPageModel>;
type AgentsPageModel = ReturnType<typeof buildAgentsPageModel>;

const readCachedAllPageModel = unstable_cache(
  readAllPageModelUncached,
  ["public-all-page-model:v2"],
  cacheOptions,
);
const readCachedCuratedPageModel = unstable_cache(
  readCuratedPageModelUncached,
  ["public-curated-page-model:v2"],
  cacheOptions,
);
const readCachedSourcesPageModel = unstable_cache(
  readSourcesPageModelUncached,
  ["public-sources-page-model:v2"],
  cacheOptions,
);
const readCachedPodcastsPageModel = unstable_cache(
  readPodcastsPageModelUncached,
  ["public-podcasts-page-model:v2"],
  cacheOptions,
);
const readCachedPodcastDetailPageModel = unstable_cache(
  readPodcastDetailPageModelUncached,
  ["public-podcast-detail-page-model:v2"],
  cacheOptions,
);
const readCachedXMonitorPageModel = unstable_cache(
  readXMonitorPageModelUncached,
  ["public-x-monitor-page-model:v2"],
  cacheOptions,
);
const readCachedDailyIndexPageModel = unstable_cache(
  readDailyIndexPageModelUncached,
  ["public-daily-index-page-model:v2"],
  cacheOptions,
);
const readCachedDailyDatePageModel = unstable_cache(
  readDailyDatePageModelUncached,
  ["public-daily-date-page-model:v2"],
  cacheOptions,
);
const readCachedAgentsPageModel = unstable_cache(
  readAgentsPageModelUncached,
  ["public-agents-page-model:v2"],
  cacheOptions,
);

export async function readAllPageModel(
  input: AllPageModelInput,
): Promise<AllPageModel> {
  return readCachedAllPageModel(input);
}

async function readAllPageModelUncached(
  input: AllPageModelInput,
): Promise<AllPageModel> {
  const scoped = await publicSnapshotReader().readReleaseScoped(async (scope) => {
    const nowMs = Date.now();
    if (!supportsDirectPublicRouteReads(scope.release)) {
      return buildAllPageModel((await scope.readCanonicalState()).state, nowMs, input);
    }
    const published = await readScopedMaterializedPageModel<AllPageModel>(
      scope,
      materializedPageLogicalName.all(input.locale),
    );
    if (isDefaultAllInput(input)) return published;
    const result = await readDirectPublicFeedStories(
      scope,
      allPageFeedQuery(input),
      nowMs,
    );
    return { ...published, stories: result.stories };
  });
  return scoped.value;
}

export async function readCuratedPageModel(
  input: CuratedPageModelInput,
): Promise<CuratedPageModel> {
  return readCachedCuratedPageModel(input);
}

async function readCuratedPageModelUncached(
  input: CuratedPageModelInput,
): Promise<CuratedPageModel> {
  const scoped = await publicSnapshotReader().readReleaseScoped(async (scope) => {
    const nowMs = Date.now();
    if (!supportsDirectPublicRouteReads(scope.release)) {
      return buildCuratedPageModel(
        (await scope.readCanonicalState()).state,
        nowMs,
        input,
      );
    }
    const published = await readScopedMaterializedPageModel<CuratedPageModel>(
      scope,
      materializedPageLogicalName.curated(input.locale),
    );
    if (isDefaultCuratedInput(input)) return published;
    const result = await readDirectPublicFeedStories(
      scope,
      curatedPageFeedQuery(input),
      nowMs,
    );
    return { ...published, stories: result.stories };
  });
  return scoped.value;
}

export async function readSourcesPageModel(): Promise<SourcesPageModel> {
  return readCachedSourcesPageModel();
}

async function readSourcesPageModelUncached(): Promise<SourcesPageModel> {
  const scoped = await publicSnapshotReader().readReleaseScoped(async (scope) => {
    if (!supportsDirectPublicRouteReads(scope.release)) {
      const snapshot = await scope.readCanonicalState();
      return buildSourcesPageModel(snapshot.state, Date.now());
    }
    return readScopedMaterializedPageModel<SourcesPageModel>(
      scope,
      materializedPageLogicalName.sources,
    );
  });
  return scoped.value;
}

export async function readPodcastsPageModel(
  input: PodcastsPageModelInput,
): Promise<PodcastsPageModel> {
  return readCachedPodcastsPageModel(input);
}

async function readPodcastsPageModelUncached(
  input: PodcastsPageModelInput,
): Promise<PodcastsPageModel> {
  const scoped = await publicSnapshotReader().readReleaseScoped(async (scope) => {
    const nowMs = Date.now();
    if (!supportsDirectPublicRouteReads(scope.release)) {
      return buildPodcastsPageModel(
        (await scope.readCanonicalState()).state,
        nowMs,
        input,
      );
    }
    const published = await readScopedMaterializedPageModel<PodcastsPageModel>(
      scope,
      materializedPageLogicalName.podcasts(input.locale),
    );
    if (
      !input.source &&
      input.tier === DEFAULT_PODCAST_TIER &&
      input.offset === 0
    ) {
      return published;
    }
    const activeChannel = activePodcastChannel(published.channels, input.source);
    const result = await readDirectPublicFeedStories(
      scope,
      podcastsPageFeedQuery(input, activeChannel),
      nowMs,
    );
    return {
      ...published,
      activeChannel,
      stories: result.stories,
    };
  });
  return scoped.value;
}

type PublishedPodcastDetailBucket = {
  detailsById: Record<
    string,
    Record<AppLocale, NonNullable<PodcastDetailPageModel["detail"]>>
  >;
  chrome: PodcastDetailPageModel["chrome"];
};

export async function readPodcastDetailPageModel(input: {
  locale: AppLocale;
  id: number;
}): Promise<PodcastDetailPageModel> {
  return readCachedPodcastDetailPageModel(input);
}

async function readPodcastDetailPageModelUncached(input: {
  locale: AppLocale;
  id: number;
}): Promise<PodcastDetailPageModel> {
  const scoped = await publicSnapshotReader().readReleaseScoped(async (scope) => {
    const nowMs = Date.now();
    if (!supportsDirectPublicRouteReads(scope.release)) {
      const snapshot = await scope.readCanonicalState();
      const item = snapshot.state.items.find(({ id }) => id === input.id);
      const bodyMd = item?.bodyMd ?? (item
        ? await readScopedItemBody(scope, input.id)
        : null);
      return buildPodcastDetailPageModel(
        snapshot.state,
        nowMs,
        input,
        bodyMd,
      );
    }
    const published = await readScopedMaterializedPageModel<PublishedPodcastDetailBucket>(
      scope,
      materializedPageLogicalName.podcastDetails(input.id),
    );
    const detail = published.detailsById[String(input.id)]?.[input.locale];
    if (detail) return { detail, chrome: published.chrome };

    const direct = await readDirectPublicItem(scope, input.id);
    if (!direct) return { detail: null, chrome: published.chrome };
    if (direct.source.group === "podcast") {
      return scope.rejectRelease(
        new Error(`missing materialized podcast detail: ${input.id}`),
      );
    }
    return {
      detail: publicPageItemDetailFromIndex(
        direct.index,
        input.id,
        input.locale,
        nowMs,
        direct.bodyMd,
      ),
      chrome: published.chrome,
    };
  });
  return scoped.value;
}

async function readScopedItemBody(
  scope: PublicReleaseReadScope,
  id: number,
): Promise<string | null> {
  const logicalName = publicItemBodyShardLogicalName(String(id));
  let bodyMd: string | null = null;
  await scope.readLogicalArtifact(logicalName, {
    validate: (bytes) => {
      const shard = parsePublicItemBodyShardValue(
        logicalName,
        JSON.parse(new TextDecoder().decode(bytes)) as unknown,
      );
      bodyMd = shard.entities.find((entity) => entity.id === id)?.bodyMd ?? null;
    },
  });
  return bodyMd;
}

export async function readXMonitorPageModel(
  input: XMonitorPageModelInput,
): Promise<XMonitorPageModel> {
  return readCachedXMonitorPageModel(input);
}

async function readXMonitorPageModelUncached(
  input: XMonitorPageModelInput,
): Promise<XMonitorPageModel> {
  const scoped = await publicSnapshotReader().readReleaseScoped(async (scope) => {
    const nowMs = Date.now();
    if (!supportsDirectPublicRouteReads(scope.release)) {
      return buildXMonitorPageModel(
        (await scope.readCanonicalState()).state,
        nowMs,
        input,
      );
    }
    const published = await readScopedMaterializedPageModel<XMonitorPageModel>(
      scope,
      materializedPageLogicalName.xMonitor(input.locale),
    );
    if (!input.handle && input.offset === 0) return published;
    const activeIsValid = isActiveXHandle(published.handles, input.handle);
    const result = await readDirectPublicFeedStories(
      scope,
      xMonitorPageFeedQuery(input, activeIsValid),
      nowMs,
    );
    return {
      ...published,
      activeIsValid,
      stories: result.stories,
    };
  });
  return scoped.value;
}

export async function readDailyIndexPageModel(input: {
  locale: AppLocale;
  offset: number;
  take: number;
}): Promise<DailyIndexPageModel> {
  return readCachedDailyIndexPageModel(input);
}

async function readDailyIndexPageModelUncached(input: {
  locale: AppLocale;
  offset: number;
  take: number;
}): Promise<DailyIndexPageModel> {
  const scoped = await publicSnapshotReader().readReleaseScoped(async (scope) => {
    if (!supportsDirectPublicRouteReads(scope.release)) {
      return buildDailyIndexPageModel(
        (await scope.readCanonicalState()).state,
        Date.now(),
        input,
      );
    }
    const published = await readScopedMaterializedPageModel<DailyIndexPageModel>(
      scope,
      materializedPageLogicalName.daily(input.locale),
    );
    return {
      rows: published.rows.slice(input.offset, input.offset + input.take),
      chrome: published.chrome,
    };
  });
  return scoped.value;
}

export async function readDailyDatePageModel(input: {
  locale: AppLocale;
  date: string;
}): Promise<ReturnType<typeof buildDailyDatePageModel>> {
  return readCachedDailyDatePageModel(input);
}

async function readDailyDatePageModelUncached(input: {
  locale: AppLocale;
  date: string;
}): Promise<ReturnType<typeof buildDailyDatePageModel>> {
  const scoped = await publicSnapshotReader().readReleaseScoped(async (scope) => {
    if (!supportsDirectPublicRouteReads(scope.release)) {
      return buildDailyDatePageModel(
        (await scope.readCanonicalState()).state,
        Date.now(),
        input,
      );
    }
    const published = await readScopedMaterializedPageModel<DailyIndexPageModel>(
      scope,
      materializedPageLogicalName.daily(input.locale),
    );
    return {
      row: published.rows.find(({ date }) => date === input.date) ?? null,
      chrome: published.chrome,
    };
  });
  return scoped.value;
}

export async function readAgentsPageModel(): Promise<AgentsPageModel> {
  return readCachedAgentsPageModel();
}

async function readAgentsPageModelUncached(): Promise<AgentsPageModel> {
  const scoped = await publicSnapshotReader().readReleaseScoped(async (scope) => {
    if (!supportsDirectPublicRouteReads(scope.release)) {
      return buildAgentsPageModel((await scope.readCanonicalState()).state, Date.now());
    }
    return readScopedMaterializedPageModel<AgentsPageModel>(
      scope,
      materializedPageLogicalName.agents,
    );
  });
  return scoped.value;
}

function isDefaultAllInput(input: AllPageModelInput): boolean {
  return (
    !input.sourceId &&
    input.sourcePreset === "all" &&
    !input.activeDate &&
    input.offset === 0
  );
}

function isDefaultCuratedInput(input: CuratedPageModelInput): boolean {
  return !input.sourceId && !input.activeDate && input.offset === 0;
}

export {
  buildDailyDatePageModel,
  type AllPageModelInput,
  type CuratedPageModelInput,
  type PodcastsPageModelInput,
  type XMonitorPageModelInput,
};
