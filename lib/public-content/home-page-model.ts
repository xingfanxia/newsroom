import { unstable_cache } from "next/cache";
import { readPublicPageSnapshot } from "@/lib/public-content/page-data";
import {
  materializedPageLogicalName,
  readMaterializedPageModel,
} from "@/lib/public-content/materialized-artifact";
import {
  buildPublicHomePageModelFromSnapshot,
  type PublicHomePageModel,
  type PublicHomePageModelInput,
} from "@/lib/public-content/page-model-builders";
import { DEFAULT_HOME_TIER, DEFAULT_HOME_VIEW } from "@/lib/feed/home-filters";
import { DEFAULT_SOURCE_PRESET } from "@/lib/feed/source-presets";

const PUBLIC_HOME_MODEL_CACHE_TAG = "public-home-model";
const PUBLIC_HOME_MODEL_CACHE_TTL = 600;

async function buildPublicHomePageModel(
  input: PublicHomePageModelInput,
): Promise<PublicHomePageModel> {
  const { state, nowMs } = await readPublicPageSnapshot();
  return buildPublicHomePageModelFromSnapshot(state, nowMs, input);
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
  if (
    input.tier === DEFAULT_HOME_TIER &&
    input.sourcePreset === DEFAULT_SOURCE_PRESET &&
    !input.sourceId &&
    !input.activeDate &&
    input.homeView === DEFAULT_HOME_VIEW
  ) {
    const published = await readMaterializedPageModel<PublicHomePageModel>(
      materializedPageLogicalName.home(input.locale),
    );
    if (published) return published;
  }
  return readCachedModel(input);
}

export {
  type PublicHomePageModel,
  type PublicHomePageModelInput,
};
