import { z } from "zod";
import type { PublicReleaseReadScope } from "@/lib/public-content/reader/types";
import { publicSourceSchema } from "@/lib/public-content/contracts";
import {
  APP_LOCALES,
  SOURCE_KINDS,
  VISIBLE_ITEM_TIERS,
  type AppLocale,
} from "@/lib/types";

export const materializedPageLogicalName = {
  home: (locale: AppLocale) => `views/home/${locale}`,
  all: (locale: AppLocale) => `views/all/${locale}`,
  curated: (locale: AppLocale) => `views/curated/${locale}`,
  sources: "views/sources",
  podcasts: (locale: AppLocale) => `views/podcasts/${locale}`,
  xMonitor: (locale: AppLocale) => `views/x-monitor/${locale}`,
  daily: (locale: AppLocale) => `views/daily/${locale}`,
  agents: "views/agents",
  podcastDetails: (id: number) =>
    `views/podcast-details/${podcastDetailBucket(id)}`,
} as const;

export const MATERIALIZED_PODCAST_DETAIL_BUCKET_COUNT = 16;
const MATERIALIZED_PODCAST_DETAIL_LOGICAL_NAMES = Array.from(
  { length: MATERIALIZED_PODCAST_DETAIL_BUCKET_COUNT },
  (_, bucket) => `views/podcast-details/${bucket.toString(16).padStart(2, "0")}`,
);

export const REQUIRED_MATERIALIZED_PAGE_LOGICAL_NAMES = [
  materializedPageLogicalName.home("en"),
  materializedPageLogicalName.home("zh"),
  materializedPageLogicalName.all("en"),
  materializedPageLogicalName.all("zh"),
  materializedPageLogicalName.curated("en"),
  materializedPageLogicalName.curated("zh"),
  materializedPageLogicalName.sources,
  materializedPageLogicalName.podcasts("en"),
  materializedPageLogicalName.podcasts("zh"),
  materializedPageLogicalName.xMonitor("en"),
  materializedPageLogicalName.xMonitor("zh"),
  materializedPageLogicalName.daily("en"),
  materializedPageLogicalName.daily("zh"),
  materializedPageLogicalName.agents,
  ...MATERIALIZED_PODCAST_DETAIL_LOGICAL_NAMES,
] as const;

function podcastDetailBucket(id: number): string {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new TypeError("podcast detail ID must be a positive safe integer");
  }
  return (id % MATERIALIZED_PODCAST_DETAIL_BUCKET_COUNT)
    .toString(16)
    .padStart(2, "0");
}

export type MaterializedPageArtifact<T = unknown> = {
  schemaVersion: 1;
  model: T;
};

export function materializedPageArtifact<T>(
  model: T,
): MaterializedPageArtifact<T> {
  return { schemaVersion: 1, model };
}

export function parseMaterializedPageArtifact<T = unknown>(
  bytes: Uint8Array,
  logicalName?: string,
): MaterializedPageArtifact<T> {
  const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (value as Record<string, unknown>).schemaVersion !== 1 ||
    !("model" in value)
  ) {
    throw new Error("invalid materialized page artifact");
  }
  const artifact = value as MaterializedPageArtifact<unknown>;
  return {
    schemaVersion: 1,
    model: logicalName
      ? parseMaterializedPageModel(logicalName, artifact.model) as T
      : artifact.model as T,
  };
}

export async function readScopedMaterializedPageModel<T>(
  scope: PublicReleaseReadScope,
  logicalName: string,
): Promise<T> {
  let model: T | undefined;
  await scope.readLogicalArtifact(logicalName, {
    required: true,
    validate: (bytes) => {
      model = parseMaterializedPageArtifact<T>(bytes, logicalName).model;
    },
  });
  return model!;
}

const passthrough = <T extends z.ZodRawShape>(shape: T) =>
  z.object(shape).passthrough();

const chromeSchema = passthrough({
  radarStats: passthrough({
    items_today: z.number().int().nonnegative(),
    items_p1: z.number().int().nonnegative(),
    items_featured: z.number().int().nonnegative(),
    tracked_sources: z.number().int().nonnegative(),
  }),
  topBarStats: passthrough({
    tracked_sources: z.number().int().nonnegative(),
    signal_ratio: z.number().min(0).max(1),
  }),
  pulse: z.array(passthrough({ h: z.number().int(), c: z.number().int().nonnegative() })).optional(),
});

const storySchema = passthrough({
  id: z.string().regex(/^\d+$/),
  sourceId: z.string(),
  source: passthrough({
    publisher: z.string(),
    kindCode: z.enum(SOURCE_KINDS),
    localeCode: z.string(),
    groupCode: z.string().optional(),
  }),
  featured: z.boolean(),
  title: z.string(),
  summary: z.string(),
  tags: z.array(z.string()),
  importance: z.number().int(),
  tier: z.enum(VISIBLE_ITEM_TIERS),
  publishedAt: z.string().datetime(),
  url: z.string(),
  locale: z.string(),
});

const daySchema = passthrough({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  count: z.number().int().nonnegative(),
});

const dailySchema = passthrough({
  id: z.number().int().positive(),
  locale: z.enum(APP_LOCALES),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  generated_at: z.string().datetime(),
  window_start: z.string().datetime(),
  window_end: z.string().datetime(),
  title: z.string().nullable(),
  theme_tag: z.string().nullable(),
  summary_md: z.string().nullable(),
  narrative_md: z.string().nullable(),
  featured_item_ids: z.array(z.number().int().positive()),
  item_ids: z.array(z.number().int().positive()),
  story_count: z.number().int().nonnegative(),
});

const storyListModelSchema = passthrough({
  stories: z.array(storySchema),
  chrome: chromeSchema,
});

function parseMaterializedPageModel(logicalName: string, model: unknown): unknown {
  if (logicalName.startsWith("views/home/")) {
    return storyListModelSchema.extend({
      topics: z.array(passthrough({ tag: z.string(), count: z.number().int(), hot: z.boolean() })),
      policy: passthrough({ version: z.string(), lastIterAt: z.string().nullable() }),
      tickerItems: z.array(passthrough({ lab: z.string(), val: z.string() })),
      days: z.array(daySchema),
    }).parse(model);
  }
  if (
    logicalName.startsWith("views/all/") ||
    logicalName.startsWith("views/curated/")
  ) {
    return storyListModelSchema.extend({ days: z.array(daySchema) }).parse(model);
  }
  if (logicalName === materializedPageLogicalName.sources) {
    return passthrough({ live: z.array(publicSourceSchema), chrome: chromeSchema }).parse(model);
  }
  if (logicalName.startsWith("views/podcasts/")) {
    return storyListModelSchema.extend({
      channels: z.array(passthrough({
        id: z.string(),
        nameEn: z.string(),
        nameZh: z.string(),
        count: z.number().int().nonnegative(),
      })),
      activeChannel: z.string().nullable(),
    }).parse(model);
  }
  if (logicalName.startsWith("views/x-monitor/")) {
    return storyListModelSchema.extend({
      handles: z.array(passthrough({
        id: z.string(),
        handle: z.string(),
        nameEn: z.string(),
        nameZh: z.string(),
        last24h: z.number().int().nonnegative(),
        total: z.number().int().nonnegative(),
      })),
      activeIsValid: z.boolean(),
    }).parse(model);
  }
  if (logicalName.startsWith("views/daily/")) {
    return passthrough({ rows: z.array(dailySchema), chrome: chromeSchema }).parse(model);
  }
  if (logicalName === materializedPageLogicalName.agents) {
    return passthrough({ chrome: chromeSchema }).parse(model);
  }
  if (logicalName.startsWith("views/podcast-details/")) {
    const detailSchema = passthrough({ story: storySchema, bodyMd: z.string().nullable() });
    return passthrough({
      detailsById: z.record(
        z.string(),
        passthrough({ en: detailSchema, zh: detailSchema }),
      ),
      chrome: chromeSchema,
    }).parse(model);
  }
  throw new Error(`unknown materialized page artifact: ${logicalName}`);
}
