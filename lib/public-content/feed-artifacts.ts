import { z } from "zod";
import {
  DEFAULT_FEED_HOT_WINDOW_HOURS,
  DEFAULT_FEED_LIMIT,
  DEFAULT_FEED_OFFSET,
  DEFAULT_FEED_TIER,
  DEFAULT_FEED_VIEW,
} from "@/lib/feed/query-defaults";
import {
  toApiItemCommonFields,
  toApiItemEventFields,
  toPublicHkr,
} from "@/lib/api/story-item-fields";
import { canonicalStateSchema } from "@/lib/public-content/contracts";
import {
  queryPublicFeed,
  type PublicFeedQuery,
} from "@/lib/public-content/query";
import {
  APP_LOCALES,
  SOURCE_GROUPS,
  SOURCE_KINDS,
  VISIBLE_ITEM_TIERS,
  type AppLocale,
  type Story,
} from "@/lib/types";

export const PUBLIC_FEED_DIRECTORY_LOGICAL_NAME = "feeds/directory";
export const PUBLIC_FEED_SEGMENT_BUCKET_COUNT = 4;
const DAY_MS = 86_400_000;

const localizedTupleSchema = <T extends z.ZodTypeAny>(value: T) =>
  z.tuple([value, value]);

const publicHkrSchema = z
  .strictObject({ h: z.boolean(), k: z.boolean(), r: z.boolean() })
  .nullable();

export const publicFeedApiItemSchema = z.strictObject({
  id: z.string().regex(/^\d+$/),
  title: z.string(),
  summary: z.string(),
  publisher: z.string(),
  source_id: z.string(),
  source_group: z.enum(SOURCE_GROUPS).nullable(),
  source_kind: z.enum(SOURCE_KINDS),
  tier: z.enum(VISIBLE_ITEM_TIERS),
  importance: z.number().int(),
  hkr: publicHkrSchema,
  tags: z.array(z.string()),
  url: z.string(),
  published_at: z.string().datetime(),
  has_commentary: z.boolean(),
  cluster_id: z.number().int().positive().nullable(),
  coverage: z.number().int().positive().nullable(),
  canonical_title: z.string().nullable(),
  first_seen_at: z.string().datetime().nullable(),
  latest_member_at: z.string().datetime().nullable(),
});

/**
 * On-wire rows are tuples because repeated JSON property names add multiple
 * megabytes at corpus scale. Keep this positional map and its parser together.
 */
const ROW = {
  id: 0,
  publishedAt: 1,
  effectiveImportance: 2,
  effectiveTier: 3,
  sourceId: 4,
  sourceGroup: 5,
  sourceKind: 6,
  sourceCurated: 7,
  sourceTags: 8,
  hkrBits: 9,
  tags: 10,
  url: 11,
  clusterId: 12,
  coverage: 13,
  eventFirstSeenAt: 14,
  eventLatestMemberAt: 15,
  title: 16,
  summary: 17,
  publisher: 18,
  hasCommentary: 19,
  canonicalTitle: 20,
} as const;

export const publicFeedRowSchema = z.tuple([
  z.number().int().positive(),
  z.string().datetime(),
  z.number().int(),
  z.enum(VISIBLE_ITEM_TIERS),
  z.string(),
  z.enum(SOURCE_GROUPS),
  z.enum(SOURCE_KINDS),
  z.boolean(),
  z.array(z.string()),
  z.number().int().min(0).max(7).nullable(),
  z.array(z.string()),
  z.string(),
  z.number().int().positive().nullable(),
  z.number().int().positive().nullable(),
  z.string().datetime().nullable(),
  z.string().datetime().nullable(),
  localizedTupleSchema(z.string()),
  localizedTupleSchema(z.string()),
  localizedTupleSchema(z.string()),
  localizedTupleSchema(z.boolean()),
  localizedTupleSchema(z.string().nullable()),
]);

export const publicFeedSegmentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("public-feed-segment"),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  bucket: z.number().int().min(0).max(PUBLIC_FEED_SEGMENT_BUCKET_COUNT - 1),
  rows: z.array(publicFeedRowSchema),
});

const publicFeedDirectoryEntrySchema = z.strictObject({
  logicalName: z.string(),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  bucket: z.number().int().min(0).max(PUBLIC_FEED_SEGMENT_BUCKET_COUNT - 1),
  count: z.number().int().positive(),
  minPublishedAt: z.string().datetime(),
  maxPublishedAt: z.string().datetime(),
});

export const publicFeedDirectorySchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("public-feed-directory"),
  segments: z.array(publicFeedDirectoryEntrySchema),
});

const publicFeedResultSchema = z.strictObject({
  items: z.array(publicFeedApiItemSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  view: z.enum(["archive", "today"]),
});

export const publicFeedDefaultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("public-feed-default"),
  locale: z.enum(APP_LOCALES),
  result: publicFeedResultSchema,
});

export type PublicFeedRow = z.infer<typeof publicFeedRowSchema>;
export type PublicFeedSegment = z.infer<typeof publicFeedSegmentSchema>;
export type PublicFeedDirectory = z.infer<typeof publicFeedDirectorySchema>;
export type PublicFeedResult = z.infer<typeof publicFeedResultSchema>;

export type PublicFeedArtifactValue = {
  logicalName: string;
  value: unknown;
};

export function publicFeedDefaultLogicalName(locale: AppLocale): string {
  return `feeds/default/${locale}`;
}

export function publicFeedRowId(row: PublicFeedRow): number {
  return row[ROW.id];
}

export function publicFeedSegmentLogicalName(
  month: string,
  bucket: number,
): string {
  return `feeds/segments/${month}/${bucket}`;
}

export function buildPublicFeedArtifactValues(
  value: unknown,
  nowMs: number,
): PublicFeedArtifactValue[] {
  const state = canonicalStateSchema.parse(value);
  const rows = publicFeedRowsFromState(state, nowMs);
  const grouped = new Map<string, PublicFeedRow[]>();
  for (const row of rows) {
    const month = row[ROW.publishedAt].slice(0, 7);
    const bucket = row[ROW.id] % PUBLIC_FEED_SEGMENT_BUCKET_COUNT;
    const logicalName = publicFeedSegmentLogicalName(month, bucket);
    const segmentRows = grouped.get(logicalName) ?? [];
    segmentRows.push(row);
    grouped.set(logicalName, segmentRows);
  }

  const segments: PublicFeedArtifactValue[] = [];
  const directoryEntries: Array<z.infer<typeof publicFeedDirectoryEntrySchema>> = [];
  for (const [logicalName, segmentRows] of [...grouped].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const [, , month, bucketRaw] = logicalName.split("/");
    const bucket = Number(bucketRaw);
    segmentRows.sort(compareRowsDefault);
    const timestamps = segmentRows.map((row) => row[ROW.publishedAt]).sort();
    const segment = publicFeedSegmentSchema.parse({
      schemaVersion: 1,
      kind: "public-feed-segment",
      month,
      bucket,
      rows: segmentRows,
    });
    segments.push({ logicalName, value: segment });
    directoryEntries.push({
      logicalName,
      month: month!,
      bucket,
      count: segmentRows.length,
      minPublishedAt: timestamps[0]!,
      maxPublishedAt: timestamps.at(-1)!,
    });
  }

  const directory = publicFeedDirectorySchema.parse({
    schemaVersion: 1,
    kind: "public-feed-directory",
    segments: directoryEntries,
  });
  const defaults = APP_LOCALES.map((locale) => ({
    logicalName: publicFeedDefaultLogicalName(locale),
    value: publicFeedDefaultSchema.parse({
      schemaVersion: 1,
      kind: "public-feed-default",
      locale,
      result: queryPublicFeedRows(
        rows,
        {
          tier: DEFAULT_FEED_TIER,
          view: DEFAULT_FEED_VIEW,
          hotWindowHours: DEFAULT_FEED_HOT_WINDOW_HOURS,
          limit: DEFAULT_FEED_LIMIT,
          offset: DEFAULT_FEED_OFFSET,
          locale,
          includeSourceGroup: true,
        },
        { nowMs },
      ),
    }),
  }));
  return [
    ...segments,
    { logicalName: PUBLIC_FEED_DIRECTORY_LOGICAL_NAME, value: directory },
    ...defaults,
  ];
}

export function publicFeedRowsFromState(
  value: unknown,
  nowMs: number,
): PublicFeedRow[] {
  const state = canonicalStateSchema.parse(value);
  const limit = state.items.length;
  const stories = Object.fromEntries(
    APP_LOCALES.map((locale) => [
      locale,
      queryPublicFeed(
        state,
        {
          tier: "all",
          view: "archive",
          locale,
          limit,
          offset: 0,
          includeSourceGroup: true,
        },
        { nowMs },
      ).items,
    ]),
  ) as Record<AppLocale, Story[]>;
  const zhById = new Map(stories.zh.map((story) => [story.id, story]));
  const sourcesById = new Map(state.sources.map((source) => [source.id, source]));
  return stories.en.map((story) => {
    const zh = zhById.get(story.id);
    const source = sourcesById.get(story.sourceId);
    if (!zh || !source) throw new Error(`incomplete public feed row: ${story.id}`);
    const enApi = publicFeedApiItemFromStory(story, "en");
    const zhApi = publicFeedApiItemFromStory(zh, "zh");
    return publicFeedRowSchema.parse([
      Number(story.id),
      story.publishedAt,
      story.importance,
      story.tier,
      story.sourceId,
      source.group,
      source.kind,
      source.curated,
      source.tags,
      encodePublicHkr(enApi.hkr),
      enApi.tags,
      enApi.url,
      enApi.cluster_id,
      enApi.coverage,
      enApi.first_seen_at,
      enApi.latest_member_at,
      [enApi.title, zhApi.title],
      [enApi.summary, zhApi.summary],
      [enApi.publisher, zhApi.publisher],
      [enApi.has_commentary, zhApi.has_commentary],
      [enApi.canonical_title, zhApi.canonical_title],
    ]);
  });
}

export function queryPublicFeedRows(
  rows: readonly PublicFeedRow[],
  query: PublicFeedQuery = {},
  options: { nowMs: number },
): PublicFeedResult {
  if (!Number.isFinite(options.nowMs)) throw new TypeError("nowMs must be finite");
  if (query.searchText) {
    throw new TypeError("compact public feed rows do not support lexical search");
  }
  const limit = nonNegativeInteger(query.limit ?? DEFAULT_FEED_LIMIT, "limit");
  const offset = nonNegativeInteger(query.offset ?? DEFAULT_FEED_OFFSET, "offset");
  const view = query.view ?? DEFAULT_FEED_VIEW;
  const locale = query.locale ?? "zh";
  const filtered = rows.filter((row) => matchesRow(row, query, options.nowMs));
  const total = filtered.length;
  const useDayCap = query.maxPerDay !== undefined && query.maxPerDay > 0;
  const sorted = [...filtered].sort(
    useDayCap ? compareRowsDayCapped : compareRowsDefault,
  );
  const fetchLimit = useDayCap
    ? Math.min(Math.max(limit * 5, 200), 500)
    : limit;
  const page = sorted.slice(offset, offset + fetchLimit);
  const selected = useDayCap
    ? applyDayCap(page, nonNegativeInteger(query.maxPerDay!, "maxPerDay"), limit)
    : page;
  return publicFeedResultSchema.parse({
    items: selected.map((row) => publicFeedApiItemFromRow(row, locale)),
    total,
    limit,
    offset,
    view,
  });
}

export function isDefaultPublicFeedQuery(query: PublicFeedQuery): boolean {
  return (
    (query.tier ?? DEFAULT_FEED_TIER) === DEFAULT_FEED_TIER &&
    (query.view ?? DEFAULT_FEED_VIEW) === DEFAULT_FEED_VIEW &&
    (query.hotWindowHours ?? DEFAULT_FEED_HOT_WINDOW_HOURS) ===
      DEFAULT_FEED_HOT_WINDOW_HOURS &&
    (query.limit ?? DEFAULT_FEED_LIMIT) === DEFAULT_FEED_LIMIT &&
    (query.offset ?? DEFAULT_FEED_OFFSET) === DEFAULT_FEED_OFFSET &&
    !query.sourceId &&
    !query.sourceGroup &&
    !query.sourceKind &&
    !query.date &&
    !query.dateFrom &&
    !query.dateTo &&
    !query.curatedOnly &&
    !query.excludeSourceTags?.length &&
    !query.includeSourceTags?.length
  );
}

export function selectPublicFeedSegmentLogicalNames(
  directory: PublicFeedDirectory,
  query: PublicFeedQuery,
): string[] {
  if (query.date) {
    const month = query.date.slice(0, 7);
    return directory.segments
      .filter((segment) => segment.month === month)
      .map(({ logicalName }) => logicalName);
  }
  if (!query.dateFrom && !query.dateTo) {
    return directory.segments.map(({ logicalName }) => logicalName);
  }
  const from = query.dateFrom ? Date.parse(query.dateFrom) : 0;
  const to = query.dateTo
    ? Date.parse(query.dateTo)
    : Date.parse("2999-01-01T00:00:00.000Z");
  return directory.segments
    .filter((segment) => {
      const start = Date.parse(`${segment.month}-01T00:00:00.000Z`);
      const endDate = new Date(start);
      endDate.setUTCMonth(endDate.getUTCMonth() + 1);
      return endDate.getTime() > from && start < to;
    })
    .map(({ logicalName }) => logicalName);
}

export function parsePublicFeedDirectory(bytes: Uint8Array): PublicFeedDirectory {
  const parsed = publicFeedDirectorySchema.parse(parseJson(bytes));
  const seen = new Set<string>();
  for (const segment of parsed.segments) {
    if (
      segment.logicalName !==
      publicFeedSegmentLogicalName(segment.month, segment.bucket)
    ) {
      throw new Error(
        `public feed directory metadata mismatch: ${segment.logicalName}`,
      );
    }
    if (seen.has(segment.logicalName)) {
      throw new Error(`duplicate public feed directory entry: ${segment.logicalName}`);
    }
    seen.add(segment.logicalName);
    if (Date.parse(segment.minPublishedAt) > Date.parse(segment.maxPublishedAt)) {
      throw new Error(
        `public feed directory bounds are reversed: ${segment.logicalName}`,
      );
    }
  }
  return parsed;
}

export function parsePublicFeedSegment(
  logicalName: string,
  bytes: Uint8Array,
): PublicFeedSegment {
  const parsed = publicFeedSegmentSchema.parse(parseJson(bytes));
  if (publicFeedSegmentLogicalName(parsed.month, parsed.bucket) !== logicalName) {
    throw new Error(`public feed segment metadata mismatch: ${logicalName}`);
  }
  for (const row of parsed.rows) {
    if (
      row[ROW.publishedAt].slice(0, 7) !== parsed.month ||
      row[ROW.id] % PUBLIC_FEED_SEGMENT_BUCKET_COUNT !== parsed.bucket
    ) {
      throw new Error(
        `public feed row is stored in the wrong segment: ${row[ROW.id]}`,
      );
    }
  }
  return parsed;
}

export function parsePublicFeedDefault(
  locale: AppLocale,
  bytes: Uint8Array,
) {
  const parsed = publicFeedDefaultSchema.parse(parseJson(bytes));
  if (parsed.locale !== locale) {
    throw new Error(`public feed default locale mismatch: ${locale}`);
  }
  return parsed;
}

export function publicFeedApiItemFromStory(story: Story, locale: AppLocale) {
  return publicFeedApiItemSchema.parse({
    ...toApiItemCommonFields(story, toPublicHkr(story.hkr)),
    ...toApiItemEventFields(story, locale),
  });
}

export function publicFeedApiItemFromRow(
  row: PublicFeedRow,
  locale: AppLocale,
) {
  const localized = locale === "en" ? 0 : 1;
  return publicFeedApiItemSchema.parse({
    id: String(row[ROW.id]),
    title: row[ROW.title][localized],
    summary: row[ROW.summary][localized],
    publisher: row[ROW.publisher][localized],
    source_id: row[ROW.sourceId],
    source_group: row[ROW.sourceGroup],
    source_kind: row[ROW.sourceKind],
    tier: row[ROW.effectiveTier],
    importance: row[ROW.effectiveImportance],
    hkr: decodePublicHkr(row[ROW.hkrBits]),
    tags: row[ROW.tags],
    url: row[ROW.url],
    published_at: row[ROW.publishedAt],
    has_commentary: row[ROW.hasCommentary][localized],
    cluster_id: row[ROW.clusterId],
    coverage: row[ROW.coverage],
    canonical_title: row[ROW.canonicalTitle][localized],
    first_seen_at: row[ROW.eventFirstSeenAt],
    latest_member_at: row[ROW.eventLatestMemberAt],
  });
}

function matchesRow(
  row: PublicFeedRow,
  query: PublicFeedQuery,
  nowMs: number,
): boolean {
  const tier = query.tier ?? DEFAULT_FEED_TIER;
  if (
    (tier === "p1" && row[ROW.effectiveTier] !== "p1") ||
    (tier === "featured" &&
      row[ROW.effectiveTier] !== "featured" &&
      row[ROW.effectiveTier] !== "p1")
  ) {
    return false;
  }
  if (query.sourceId) {
    if (row[ROW.sourceId] !== query.sourceId) return false;
  } else {
    if (query.sourceGroup && row[ROW.sourceGroup] !== query.sourceGroup) return false;
    if (query.sourceKind && row[ROW.sourceKind] !== query.sourceKind) return false;
  }
  if (query.curatedOnly && !row[ROW.sourceCurated]) return false;
  if (overlaps(row[ROW.sourceTags], query.excludeSourceTags)) return false;
  if (
    query.includeSourceTags?.length &&
    !overlaps(row[ROW.sourceTags], query.includeSourceTags)
  ) {
    return false;
  }
  const publishedMs = Date.parse(row[ROW.publishedAt]);
  if (!matchesDateBounds(row, publishedMs, query, nowMs)) return false;
  if (
    query.recencyFloorDays !== undefined &&
    query.recencyFloorDays > 0 &&
    !query.date &&
    !query.dateFrom &&
    !query.dateTo &&
    publishedMs < nowMs - query.recencyFloorDays * DAY_MS
  ) {
    return false;
  }
  if (query.minImportance !== undefined && query.minImportance > 0) {
    const rescueDays = query.recentDayRescueDays ?? 0;
    const rescued =
      rescueDays > 0 &&
      publishedMs >= startOfUtcDay(nowMs) - (rescueDays - 1) * DAY_MS;
    if (row[ROW.effectiveImportance] < query.minImportance && !rescued) {
      return false;
    }
  }
  return true;
}

function matchesDateBounds(
  row: PublicFeedRow,
  publishedMs: number,
  query: PublicFeedQuery,
  nowMs: number,
): boolean {
  if (query.date) {
    const start = Date.parse(`${query.date}T00:00:00.000Z`);
    return publishedMs >= start && publishedMs < start + DAY_MS;
  }
  if (query.dateFrom || query.dateTo) {
    const from = query.dateFrom ? Date.parse(query.dateFrom) : 0;
    const to = query.dateTo
      ? Date.parse(query.dateTo)
      : Date.parse("2999-01-01T00:00:00.000Z");
    return publishedMs >= from && publishedMs < to;
  }
  if ((query.view ?? DEFAULT_FEED_VIEW) !== "today") return true;
  const startToday = startOfUtcDay(nowMs);
  const hotWindowMs =
    (query.hotWindowHours ?? DEFAULT_FEED_HOT_WINDOW_HOURS) * 3_600_000;
  const eventFirstSeenAt = row[ROW.eventFirstSeenAt];
  const eventLatestMemberAt = row[ROW.eventLatestMemberAt];
  return (
    (eventFirstSeenAt !== null && Date.parse(eventFirstSeenAt) >= startToday) ||
    (eventLatestMemberAt !== null &&
      Date.parse(eventLatestMemberAt) > nowMs - hotWindowMs) ||
    publishedMs >= startToday - DAY_MS
  );
}

function compareRowsDefault(left: PublicFeedRow, right: PublicFeedRow): number {
  return (
    right[ROW.publishedAt].localeCompare(left[ROW.publishedAt]) ||
    right[ROW.effectiveImportance] - left[ROW.effectiveImportance] ||
    right[ROW.id] - left[ROW.id]
  );
}

function compareRowsDayCapped(left: PublicFeedRow, right: PublicFeedRow): number {
  return (
    right[ROW.publishedAt]
      .slice(0, 10)
      .localeCompare(left[ROW.publishedAt].slice(0, 10)) ||
    right[ROW.effectiveImportance] - left[ROW.effectiveImportance] ||
    right[ROW.publishedAt].localeCompare(left[ROW.publishedAt]) ||
    right[ROW.id] - left[ROW.id]
  );
}

function applyDayCap(
  rows: PublicFeedRow[],
  maxPerDay: number,
  limit: number,
): PublicFeedRow[] {
  if (limit === 0) return [];
  const counts = new Map<string, number>();
  const selected: PublicFeedRow[] = [];
  for (const row of rows) {
    const day = row[ROW.publishedAt].slice(0, 10);
    const count = counts.get(day) ?? 0;
    if (count >= maxPerDay) continue;
    counts.set(day, count + 1);
    selected.push(row);
    if (selected.length >= limit) break;
  }
  return selected;
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative integer`);
  }
  return value;
}

function overlaps(left: readonly string[], right: readonly string[] | undefined) {
  return Boolean(right?.some((value) => left.includes(value)));
}

function encodePublicHkr(
  value: z.infer<typeof publicHkrSchema>,
): number | null {
  if (!value) return null;
  return (value.h ? 1 : 0) | (value.k ? 2 : 0) | (value.r ? 4 : 0);
}

function decodePublicHkr(bits: number | null): z.infer<typeof publicHkrSchema> {
  if (bits === null) return null;
  return { h: Boolean(bits & 1), k: Boolean(bits & 2), r: Boolean(bits & 4) };
}

function startOfUtcDay(nowMs: number): number {
  return nowMs - (nowMs % DAY_MS);
}

function parseJson(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}
