import { unstable_cache } from "next/cache";
import {
  readDirectPublicFeedStories,
  supportsDirectPublicRouteReads,
} from "@/lib/public-content/direct-route-read";
import {
  materializedPageLogicalName,
  readScopedMaterializedPageModel,
} from "@/lib/public-content/materialized-artifact";
import {
  buildPublicHomePageModelFromSnapshot,
  publicHomePageFeedQuery,
  type PublicHomePageModel,
  type PublicHomePageModelInput,
} from "@/lib/public-content/page-model-builders";
import { publicSnapshotReader } from "@/lib/public-content/reader";
import { DEFAULT_HOME_TIER, DEFAULT_HOME_VIEW } from "@/lib/feed/home-filters";
import { DEFAULT_SOURCE_PRESET } from "@/lib/feed/source-presets";

const PUBLIC_HOME_MODEL_CACHE_TAG = "public-home-model";
const PUBLIC_HOME_MODEL_CACHE_TTL = 600;

async function buildPublicHomePageModel(
  input: PublicHomePageModelInput,
): Promise<PublicHomePageModel> {
  const scoped = await publicSnapshotReader().readReleaseScoped(async (scope) => {
    const nowMs = Date.now();
    if (!supportsDirectPublicRouteReads(scope.release)) {
      const snapshot = await scope.readCanonicalState();
      return buildPublicHomePageModelFromSnapshot(snapshot.state, nowMs, input);
    }
    const published = await readScopedMaterializedPageModel<PublicHomePageModel>(
      scope,
      materializedPageLogicalName.home(input.locale),
    );
    if (isDefaultInput(input)) return published;
    const result = await readDirectPublicFeedStories(
      scope,
      publicHomePageFeedQuery(input),
      nowMs,
    );
    return { ...published, stories: result.stories };
  });
  return scoped.value;
}

const readCachedModel = unstable_cache(
  buildPublicHomePageModel,
  ["public-home-model:v1"],
  {
    revalidate: PUBLIC_HOME_MODEL_CACHE_TTL,
    tags: [PUBLIC_HOME_MODEL_CACHE_TAG],
  },
);

export async function readCachedPublicHomePageModel(
  input: PublicHomePageModelInput,
): Promise<PublicHomePageModel> {
  return readCachedModel(input);
}

function isDefaultInput(input: PublicHomePageModelInput): boolean {
  return (
    input.tier === DEFAULT_HOME_TIER &&
    input.sourcePreset === DEFAULT_SOURCE_PRESET &&
    !input.sourceId &&
    !input.activeDate &&
    input.homeView === DEFAULT_HOME_VIEW
  );
}

export {
  type PublicHomePageModel,
  type PublicHomePageModelInput,
};
