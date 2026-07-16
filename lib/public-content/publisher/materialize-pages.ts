import {
  materializedPageArtifact,
  materializedPageLogicalName,
  MATERIALIZED_PODCAST_DETAIL_BUCKET_COUNT,
} from "@/lib/public-content/materialized-artifact";
import {
  buildAgentsPageModel,
  buildAllPageModel,
  buildCuratedPageModel,
  buildDailyIndexPageModel,
  buildPodcastsPageModel,
  buildPublicHomePageModelFromSnapshot,
  buildSourcesPageModel,
  buildXMonitorPageModel,
} from "@/lib/public-content/page-model-builders";
import { DEFAULT_HOME_TIER, DEFAULT_HOME_VIEW } from "@/lib/feed/home-filters";
import { DEFAULT_PODCAST_TIER } from "@/lib/feed/podcast-filters";
import { DEFAULT_SOURCE_PRESET } from "@/lib/feed/source-presets";
import type { CanonicalPublicState } from "@/lib/public-content/contracts";
import { publicPageItemDetailFromIndex } from "@/lib/public-content/page-data";
import { createPublicStateIndex } from "@/lib/public-content/public-items";
import { shellChromeDataFromSnapshot } from "@/lib/shell/chrome-data";
import type { AppLocale } from "@/lib/types";

export type MaterializedPageModel = {
  logicalName: string;
  value: ReturnType<typeof materializedPageArtifact>;
};

export function buildMaterializedPageModels(
  state: CanonicalPublicState,
  nowMs: number,
  getBody: (id: number) => string | null,
): MaterializedPageModel[] {
  const artifacts: MaterializedPageModel[] = [];
  const locales: AppLocale[] = ["en", "zh"];

  for (const locale of locales) {
    artifacts.push(
      model(
        materializedPageLogicalName.home(locale),
        buildPublicHomePageModelFromSnapshot(state, nowMs, {
          locale,
          tier: DEFAULT_HOME_TIER,
          sourcePreset: DEFAULT_SOURCE_PRESET,
          homeView: DEFAULT_HOME_VIEW,
        }),
      ),
      model(
        materializedPageLogicalName.all(locale),
        buildAllPageModel(state, nowMs, {
          locale,
          sourcePreset: DEFAULT_SOURCE_PRESET,
          offset: 0,
        }),
      ),
      model(
        materializedPageLogicalName.curated(locale),
        buildCuratedPageModel(state, nowMs, { locale, offset: 0 }),
      ),
      model(
        materializedPageLogicalName.podcasts(locale),
        buildPodcastsPageModel(state, nowMs, {
          locale,
          tier: DEFAULT_PODCAST_TIER,
        }),
      ),
      model(
        materializedPageLogicalName.xMonitor(locale),
        buildXMonitorPageModel(state, nowMs, { locale }),
      ),
      model(
        materializedPageLogicalName.daily(locale),
        buildDailyIndexPageModel(state, nowMs, {
          locale,
          offset: 0,
          take: state.newsletters.length,
        }),
      ),
    );
  }

  artifacts.push(
    model(
      materializedPageLogicalName.sources,
      buildSourcesPageModel(state, nowMs),
    ),
    model(
      materializedPageLogicalName.agents,
      buildAgentsPageModel(state, nowMs),
    ),
  );

  const stateIndex = createPublicStateIndex(state);
  const detailChrome = shellChromeDataFromSnapshot(state, nowMs);
  const podcastSourceIds = new Set(
    state.sources
      .filter((source) => source.group === "podcast")
      .map((source) => source.id),
  );
  const detailBuckets = Array.from(
    { length: MATERIALIZED_PODCAST_DETAIL_BUCKET_COUNT },
    () => ({} as Record<string, { en: unknown; zh: unknown }>),
  );
  for (const item of state.items) {
    if (!podcastSourceIds.has(item.sourceId)) continue;
    const id = item.id;
    const bodyMd = item.bodyMd ?? getBody(id);
    const en = publicPageItemDetailFromIndex(
      stateIndex,
      id,
      "en",
      nowMs,
      bodyMd,
    );
    const zh = publicPageItemDetailFromIndex(
      stateIndex,
      id,
      "zh",
      nowMs,
      bodyMd,
    );
    if (!en || !zh) continue;
    detailBuckets[id % MATERIALIZED_PODCAST_DETAIL_BUCKET_COUNT]![String(id)] = {
      en,
      zh,
    };
  }
  for (let bucket = 0; bucket < detailBuckets.length; bucket += 1) {
    const representativeId = bucket === 0
      ? MATERIALIZED_PODCAST_DETAIL_BUCKET_COUNT
      : bucket;
    artifacts.push(
      model(materializedPageLogicalName.podcastDetails(representativeId), {
        detailsById: detailBuckets[bucket],
        chrome: detailChrome,
      }),
    );
  }

  return artifacts;
}

function model(logicalName: string, value: unknown): MaterializedPageModel {
  const jsonValue = JSON.parse(JSON.stringify(value)) as unknown;
  return { logicalName, value: materializedPageArtifact(jsonValue) };
}
