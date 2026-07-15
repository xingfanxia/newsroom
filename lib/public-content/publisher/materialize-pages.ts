import {
  materializedPageArtifact,
  materializedPageLogicalName,
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

  const podcastStories = buildPodcastsPageModel(state, nowMs, {
    locale: "en",
    tier: DEFAULT_PODCAST_TIER,
  }).stories;
  const stateIndex = createPublicStateIndex(state);
  const detailChrome = shellChromeDataFromSnapshot(state, nowMs);
  for (const story of podcastStories.slice(0, 120)) {
    const id = Number.parseInt(story.id, 10);
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    const en = publicPageItemDetailFromIndex(stateIndex, id, "en", nowMs);
    const zh = publicPageItemDetailFromIndex(stateIndex, id, "zh", nowMs);
    if (!en || !zh) continue;
    artifacts.push(
      model(materializedPageLogicalName.podcastDetail(id), {
        detailByLocale: { en, zh },
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
