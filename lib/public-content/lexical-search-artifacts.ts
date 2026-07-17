import { z } from "zod";
import {
  canonicalStateSchema,
  type CanonicalPublicState,
} from "@/lib/public-content/contracts";
import { matchesSqliteLikeTextValues, type PublicFeedQuery } from "./query";
import {
  SOURCE_GROUPS,
  SOURCE_KINDS,
  VISIBLE_ITEM_TIERS,
} from "@/lib/types";

export const PUBLIC_LEXICAL_SHARD_COUNT = 32;

const ROW = {
  id: 0,
  publishedAt: 1,
  effectiveImportance: 2,
  effectiveTier: 3,
  sourceId: 4,
  sourceGroup: 5,
  sourceKind: 6,
  searchTexts: 7,
} as const;

const nullableTextSchema = z.string().nullable();
const SUMMARY_EXCERPT_CHARACTERS = 64;

const publicLexicalRowSchema = z.tuple([
  z.number().int().positive(),
  z.string().datetime(),
  z.number().int(),
  z.enum(VISIBLE_ITEM_TIERS),
  z.string(),
  z.enum(SOURCE_GROUPS),
  z.enum(SOURCE_KINDS),
  z.array(z.string()).min(1),
]);

const publicLexicalShardSchema = z.strictObject({
  schemaVersion: z.literal(2),
  kind: z.literal("public-lexical-shard"),
  bucket: z.number().int().min(0).max(PUBLIC_LEXICAL_SHARD_COUNT - 1),
  rows: z.array(publicLexicalRowSchema),
});

// Transitional parser for releases published before the compact text-corpus
// format. Keeping this reader makes deployment safe: the new runtime can serve
// the active v1 release until the next publisher run flips the pointer to v2.
const legacyPublicLexicalRowSchema = z.tuple([
  z.number().int().positive(),
  z.string().datetime(),
  z.number().int(),
  z.enum(VISIBLE_ITEM_TIERS),
  z.string(),
  z.enum(SOURCE_GROUPS),
  z.enum(SOURCE_KINDS),
  z.string(),
  nullableTextSchema,
  nullableTextSchema,
  nullableTextSchema,
  nullableTextSchema,
  nullableTextSchema,
  nullableTextSchema,
]);

const legacyPublicLexicalShardSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("public-lexical-shard"),
  bucket: z.number().int().min(0).max(PUBLIC_LEXICAL_SHARD_COUNT - 1),
  rows: z.array(legacyPublicLexicalRowSchema),
});

export type PublicLexicalRow = z.infer<typeof publicLexicalRowSchema>;
export type PublicLexicalShard = z.infer<typeof publicLexicalShardSchema>;

export type PublicLexicalArtifactValue = {
  logicalName: string;
  value: PublicLexicalShard;
};

export type PublicLexicalQueryResult = {
  ids: number[];
  total: number;
  limit: number;
  offset: number;
};

type PublicItem = CanonicalPublicState["items"][number];
type PublicEvent = CanonicalPublicState["events"][number];
type PublicSource = CanonicalPublicState["sources"][number];

export function publicLexicalShardLogicalName(bucket: number): string {
  assertBucket(bucket);
  return `search/lexical/${bucket.toString(16).padStart(2, "0")}`;
}

export function publicLexicalShardLogicalNames(): string[] {
  return Array.from({ length: PUBLIC_LEXICAL_SHARD_COUNT }, (_, bucket) =>
    publicLexicalShardLogicalName(bucket),
  );
}

export function publicLexicalRowId(row: PublicLexicalRow): number {
  return row[ROW.id];
}

export function publicLexicalRowFromEntities(
  item: PublicItem,
  event: PublicEvent | undefined,
  source: PublicSource,
): PublicLexicalRow {
  if (source.id !== item.sourceId) {
    throw new Error(`public lexical source mismatch: ${item.id}`);
  }
  if (item.eventId === null ? event !== undefined : event?.id !== item.eventId) {
    throw new Error(`public lexical event mismatch: ${item.id}`);
  }
  if (event && event.leadItemId !== item.id) {
    throw new Error(`public lexical item is not the event lead: ${item.id}`);
  }
  return publicLexicalRowSchema.parse([
    item.id,
    item.publishedAt,
    event?.importance ?? item.importance,
    event?.tier ?? item.tier,
    item.sourceId,
    source.group,
    source.kind,
    compactSearchTexts([
      item.title.raw,
      item.title.zh,
      item.title.en,
      excerpt(item.summary.zh),
      excerpt(item.summary.en),
      event?.canonicalTitle.zh,
      event?.canonicalTitle.en,
    ]),
  ]);
}

export function publicLexicalRowsFromState(value: unknown): PublicLexicalRow[] {
  const state = canonicalStateSchema.parse(value);
  const eventsById = new Map(state.events.map((event) => [event.id, event]));
  const sourcesById = new Map(state.sources.map((source) => [source.id, source]));
  const rows: PublicLexicalRow[] = [];
  for (const item of state.items) {
    const event = item.eventId === null ? undefined : eventsById.get(item.eventId);
    if (item.eventId !== null && !event) {
      throw new Error(`missing public event: ${item.eventId}`);
    }
    if (event && event.leadItemId !== item.id) continue;
    const source = sourcesById.get(item.sourceId);
    if (!source) throw new Error(`missing public source: ${item.sourceId}`);
    rows.push(publicLexicalRowFromEntities(item, event, source));
  }
  return rows.sort((left, right) => left[ROW.id] - right[ROW.id]);
}

export function buildPublicLexicalArtifactValues(
  value: unknown,
): PublicLexicalArtifactValue[] {
  const buckets = Array.from(
    { length: PUBLIC_LEXICAL_SHARD_COUNT },
    (): PublicLexicalRow[] => [],
  );
  for (const row of publicLexicalRowsFromState(value)) {
    buckets[row[ROW.id] % PUBLIC_LEXICAL_SHARD_COUNT]!.push(row);
  }
  return buckets.map((rows, bucket) => ({
    logicalName: publicLexicalShardLogicalName(bucket),
    value: publicLexicalShardSchema.parse({
      schemaVersion: 2,
      kind: "public-lexical-shard",
      bucket,
      rows,
    }),
  }));
}

export function parsePublicLexicalShard(
  logicalName: string,
  bytes: Uint8Array,
): PublicLexicalShard {
  const bucket = bucketFromLogicalName(logicalName);
  const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  const current = publicLexicalShardSchema.safeParse(value);
  const parsed = current.success
    ? current.data
    : normalizeLegacyPublicLexicalShard(
        legacyPublicLexicalShardSchema.parse(value),
      );
  if (parsed.bucket !== bucket) {
    throw new Error(`public lexical shard metadata mismatch: ${logicalName}`);
  }
  const ids = new Set<number>();
  for (const row of parsed.rows) {
    const id = row[ROW.id];
    if (id % PUBLIC_LEXICAL_SHARD_COUNT !== bucket) {
      throw new Error(`public lexical row is stored in the wrong shard: ${id}`);
    }
    if (ids.has(id)) throw new Error(`duplicate public lexical row: ${id}`);
    ids.add(id);
  }
  return parsed;
}

export function queryPublicLexicalRows(
  rows: readonly PublicLexicalRow[],
  query: PublicFeedQuery,
  options: { nowMs: number },
): PublicLexicalQueryResult {
  if (!Number.isFinite(options.nowMs)) throw new TypeError("nowMs must be finite");
  if (query.searchText === undefined) {
    throw new TypeError("public lexical query requires searchText");
  }
  const limit = nonNegativeInteger(query.limit ?? 40, "limit");
  const offset = nonNegativeInteger(query.offset ?? 0, "offset");
  const filtered = rows.filter((row) => matchesRow(row, query));
  const total = filtered.length;
  const page = [...filtered]
    .sort(compareRows)
    .slice(offset, offset + limit);
  return {
    ids: page.map((row) => row[ROW.id]),
    total,
    limit,
    offset,
  };
}

function matchesRow(row: PublicLexicalRow, query: PublicFeedQuery): boolean {
  const tier = query.tier ?? "featured";
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
    if (query.sourceGroup && row[ROW.sourceGroup] !== query.sourceGroup) {
      return false;
    }
    if (query.sourceKind && row[ROW.sourceKind] !== query.sourceKind) {
      return false;
    }
  }
  const publishedMs = Date.parse(row[ROW.publishedAt]);
  if (query.date) {
    const start = parseDay(query.date);
    if (publishedMs < start || publishedMs >= start + 86_400_000) return false;
  } else if (query.dateFrom || query.dateTo) {
    const from = query.dateFrom ? parseTimestamp(query.dateFrom, "dateFrom") : 0;
    const to = query.dateTo
      ? parseTimestamp(query.dateTo, "dateTo")
      : Date.parse("2999-01-01T00:00:00.000Z");
    if (publishedMs < from || publishedMs >= to) return false;
  }
  return matchesSqliteLikeTextValues(row[ROW.searchTexts], query.searchText!);
}

function normalizeLegacyPublicLexicalShard(
  legacy: z.infer<typeof legacyPublicLexicalShardSchema>,
): PublicLexicalShard {
  return publicLexicalShardSchema.parse({
    schemaVersion: 2,
    kind: legacy.kind,
    bucket: legacy.bucket,
    rows: legacy.rows.map((row) => [
      row[0],
      row[1],
      row[2],
      row[3],
      row[4],
      row[5],
      row[6],
      compactSearchTexts([
        row[7],
        row[8],
        row[9],
        excerpt(row[10]),
        excerpt(row[11]),
        row[12],
        row[13],
      ]),
    ]),
  });
}

function compactSearchTexts(
  values: readonly (string | null | undefined)[],
): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function excerpt(value: string | null | undefined): string | null {
  return value ? value.slice(0, SUMMARY_EXCERPT_CHARACTERS) : null;
}

function compareRows(left: PublicLexicalRow, right: PublicLexicalRow): number {
  return (
    right[ROW.publishedAt].localeCompare(left[ROW.publishedAt]) ||
    right[ROW.effectiveImportance] - left[ROW.effectiveImportance] ||
    right[ROW.id] - left[ROW.id]
  );
}

function bucketFromLogicalName(logicalName: string): number {
  const match = /^search\/lexical\/([0-9a-f]{2})$/.exec(logicalName);
  if (!match) throw new Error(`invalid public lexical shard name: ${logicalName}`);
  const bucket = Number.parseInt(match[1]!, 16);
  assertBucket(bucket);
  if (publicLexicalShardLogicalName(bucket) !== logicalName) {
    throw new Error(`invalid public lexical shard name: ${logicalName}`);
  }
  return bucket;
}

function assertBucket(bucket: number): void {
  if (
    !Number.isInteger(bucket) ||
    bucket < 0 ||
    bucket >= PUBLIC_LEXICAL_SHARD_COUNT
  ) {
    throw new TypeError(`invalid public lexical shard bucket: ${bucket}`);
  }
}

function parseDay(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError(`invalid date: ${value}`);
  }
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString().slice(0, 10) !== value
  ) {
    throw new TypeError(`invalid date: ${value}`);
  }
  return parsed;
}

function parseTimestamp(value: string, field: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError(`invalid ${field}: ${value}`);
  return parsed;
}

function nonNegativeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${field} must be a non-negative safe integer`);
  }
  return value;
}
