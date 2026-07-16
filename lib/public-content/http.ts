import { z } from "zod";
import {
  eventMembersCacheSignalParts,
  parseEventMemberRouteParams,
  toEventMembersListEnvelope,
  toEventMembersPayload,
} from "@/lib/api/event-member-contract";
import {
  feedQueryFromParams,
  parsePublicFeedQueryRequest,
  parsePublicSearchQueryRequest,
  searchFeedQueryFromParams,
} from "@/lib/api/feed-query-params";
import {
  toApiItemCommonFields,
  toApiItemEventFields,
  toPublicHkr,
} from "@/lib/api/story-item-fields";
import { etagSignal } from "@/lib/api/public-helpers";
import {
  invalidQueryError,
  queryParamsRecord,
} from "@/lib/api/query-params";
import { parsePositiveRouteId } from "@/lib/api/route-params";
import type { RouteErrorResult } from "@/lib/api/route-result";
import {
  DAILY_COLUMN_INDEX_TAKE_MAX,
  DAILY_COLUMN_INDEX_TAKE_MIN,
  DEFAULT_DAILY_COLUMN_INDEX_TAKE,
  DEFAULT_DAILY_COLUMN_QUERY_LOCALE,
} from "@/lib/daily-column/query-defaults";
import {
  getLatestPublicDaily,
  getPublicDailyByDate,
  listPublicDailyIndex,
} from "@/lib/public-content/public-dailies";
import {
  PUBLIC_FEED_DIRECTORY_LOGICAL_NAME,
  isDefaultPublicFeedQuery,
  parsePublicFeedDefault,
  parsePublicFeedDirectory,
  parsePublicFeedSegment,
  publicFeedApiItemFromStory,
  publicFeedDefaultLogicalName,
  publicFeedRowId,
  queryPublicFeedRows,
  selectPublicFeedSegmentLogicalNames,
  type PublicFeedDirectory,
  type PublicFeedResult,
  type PublicFeedRow,
} from "@/lib/public-content/feed-artifacts";
import {
  PUBLIC_NUMERIC_SHARD_COUNT,
  parsePublicEntityShardValue,
  parsePublicItemBodyShardValue,
  publicEntityShardLogicalName,
  publicItemBodyShardLogicalName,
  type CanonicalPublicState,
} from "@/lib/public-content/contracts";
import {
  createPublicStateIndex,
  publicEventMembersFromIndex,
} from "@/lib/public-content/public-items";
import {
  getPublicEventMembers,
  queryPublicFeed,
} from "@/lib/public-content/query";
import {
  PublicSnapshotUnavailableError,
  publicSnapshotReader,
  type PublicSnapshotReader,
} from "@/lib/public-content/reader";
import type {
  PublicCanonicalStateResult,
  PublicReleaseReadScope,
  ResolvedPublicRelease,
} from "@/lib/public-content/reader/types";
import { APP_LOCALES, type AppLocale } from "@/lib/types";
import { PUBLIC_SEMANTIC_SEARCH_ERROR } from "@/lib/search/query-defaults";

type SnapshotCachedResult =
  | { ok: true; signal: string; body: unknown }
  | RouteErrorResult;

const dailyLocaleSchema = z
  .enum(APP_LOCALES)
  .default(DEFAULT_DAILY_COLUMN_QUERY_LOCALE);

const dailyDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((date) => {
    const parsed = Date.parse(`${date}T00:00:00.000Z`);
    return (
      Number.isFinite(parsed) &&
      new Date(parsed).toISOString().slice(0, 10) === date
    );
  });

const dailyIndexQuerySchema = z.object({
  take: z.coerce
    .number()
    .int()
    .min(DAILY_COLUMN_INDEX_TAKE_MIN)
    .max(DAILY_COLUMN_INDEX_TAKE_MAX)
    .optional()
    .default(DEFAULT_DAILY_COLUMN_INDEX_TAKE),
  locale: dailyLocaleSchema
    .optional()
    .default(DEFAULT_DAILY_COLUMN_QUERY_LOCALE),
});

export async function readPublicSnapshot(): Promise<PublicCanonicalStateResult> {
  return publicSnapshotReader().readCanonicalState();
}

export async function publicFeedSnapshotRequestResult(
  req: Request,
): Promise<SnapshotCachedResult> {
  const parsed = parsePublicFeedQueryRequest(req);
  if (!parsed.ok) {
    return {
      ok: false,
      error: invalidQueryError(parsed.issues),
      status: 400,
    };
  }
  const query = feedQueryFromParams(parsed.data);
  const reader = publicSnapshotReader();
  const scoped = await reader.readReleaseScoped(async (scope) => {
    if (!supportsDirectFeedRead(scope.release)) {
      const snapshot = await scope.readCanonicalState();
      const result = queryPublicFeed(snapshot.state, query, { nowMs: Date.now() });
      return feedSnapshotResult(
        snapshot.release,
        {
          ...result,
          items: result.items.map((story) =>
            publicFeedApiItemFromStory(story, query.locale ?? "zh"),
          ),
        },
        parsed.search,
      );
    }
    if (isDefaultPublicFeedQuery(query)) {
      const locale = query.locale ?? "zh";
      let result: PublicFeedResult | undefined;
      await scope.readLogicalArtifact(publicFeedDefaultLogicalName(locale), {
        required: true,
        validate: (bytes) => {
          result = parsePublicFeedDefault(locale, bytes).result;
        },
      });
      return feedSnapshotResult(scope.release, result!, parsed.search);
    }

    let directory: PublicFeedDirectory | undefined;
    await scope.readLogicalArtifact(PUBLIC_FEED_DIRECTORY_LOGICAL_NAME, {
      required: true,
      validate: (bytes) => {
        directory = parsePublicFeedDirectory(bytes);
      },
    });
    assertCompleteFeedDirectory(scope, directory!);
    const logicalNames = selectPublicFeedSegmentLogicalNames(directory!, query);
    const directoryByName = new Map(
      directory!.segments.map((segment) => [segment.logicalName, segment]),
    );
    const rowShards = await mapWithConcurrency(
      logicalNames,
      16,
      async (logicalName) => {
        let rows: PublicFeedRow[] | undefined;
        await scope.readLogicalArtifact(logicalName, {
          required: true,
          validate: (bytes) => {
            const segment = parsePublicFeedSegment(logicalName, bytes);
            if (segment.rows.length !== directoryByName.get(logicalName)?.count) {
              throw new Error(`public feed segment count mismatch: ${logicalName}`);
            }
            rows = segment.rows;
          },
        });
        return rows!;
      },
    );
    const rows = rowShards.flat();
    if (new Set(rows.map(publicFeedRowId)).size !== rows.length) {
      return scope.rejectRelease(new Error("duplicate public feed row"));
    }
    return feedSnapshotResult(
      scope.release,
      queryPublicFeedRows(rows, query, { nowMs: Date.now() }),
      parsed.search,
    );
  });
  return scoped.value;
}

function feedSnapshotResult(
  release: ResolvedPublicRelease,
  result: PublicFeedResult,
  search: string,
): SnapshotCachedResult {
  return {
    ok: true,
    signal: etagSignal({
      release: release.ref.manifestSha256,
      count: result.items.length,
      total: result.total,
      first_id: result.items[0]?.id ?? "",
      latest_at: result.items[0]?.published_at ?? "",
      qs: search,
    }),
    body: {
      items: result.items,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
      view: result.view,
    },
  };
}

export async function publicSearchSnapshotRequestResult(
  req: Request,
): Promise<SnapshotCachedResult> {
  const parsed = parsePublicSearchQueryRequest(req);
  if (!parsed.ok) {
    return {
      ok: false,
      error: invalidQueryError(parsed.issues),
      status: 400,
    };
  }
  if (parsed.data.mode === "semantic") {
    return {
      ok: false,
      error: PUBLIC_SEMANTIC_SEARCH_ERROR,
      status: 422,
    };
  }
  const snapshot = await readPublicSnapshot();
  const result = queryPublicFeed(
    snapshot.state,
    searchFeedQueryFromParams(parsed.data),
    { nowMs: Date.now() },
  );
  return {
    ok: true,
    signal: etagSignal({
      release: snapshot.release.ref.manifestSha256,
      qs: parsed.search,
      total: result.total,
      first: result.items[0]?.id ?? "",
    }),
    body: {
      mode: "lexical",
      q: parsed.data.q,
      items: result.items.map((story) =>
        toSnapshotPublicApiItem(story, parsed.data.locale),
      ),
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    },
  };
}

export async function publicSourcesSnapshotResult(): Promise<SnapshotCachedResult> {
  const artifact = await publicSnapshotReader().readLogicalArtifact(
    "state/sources",
    { required: true, validate: parsePublicSourceRows },
  );
  if (!artifact) throw new PublicSnapshotUnavailableError();
  const rows = [...parsePublicSourceRows(artifact.bytes)].sort(
    (left, right) => left.priority - right.priority || left.id.localeCompare(right.id),
  );
  return {
    ok: true,
    signal: etagSignal({
      release: artifact.release.ref.manifestSha256,
      count: rows.length,
      latest_success:
        rows
          .map((row) => row.health.lastSuccessAt ?? "")
          .sort()
          .pop() ?? "",
    }),
    body: {
      sources: rows.map((row) => ({
        id: row.id,
        name_en: row.name.en,
        name_zh: row.name.zh,
        url: row.url,
        kind: row.kind,
        group: row.group,
        locale: row.locale,
        cadence: row.cadence,
        priority: row.priority,
        tags: [...row.tags],
        enabled: row.enabled,
        curated: row.curated,
        health: {
          status: row.health.status,
          last_success_at: row.health.lastSuccessAt,
          consecutive_failures: row.health.consecutiveFailures,
          total_items_count: row.health.totalItemsCount,
        },
      })),
      total: rows.length,
    },
  };
}

function parsePublicSourceRows(bytes: Uint8Array) {
  const shard = parsePublicEntityShardValue(
    "state/sources",
    JSON.parse(new TextDecoder().decode(bytes)) as unknown,
  );
  if (shard.entityType !== "source") {
    throw new Error("public sources artifact has the wrong entity type");
  }
  return shard.entities;
}

export function activeSourcesSnapshotBody(
  snapshot: PublicCanonicalStateResult,
): unknown {
  const sources = snapshot.state.sources
    .filter((source) => source.enabled)
    .sort(
      (left, right) =>
        left.group.localeCompare(right.group) ||
        left.name.en.localeCompare(right.name.en) ||
        left.id.localeCompare(right.id),
    )
    .map((source) => ({
      id: source.id,
      name_en: source.name.en,
      name_zh: source.name.zh,
      kind: source.kind,
      group: source.group,
      locale: source.locale,
    }));
  return { sources, total: sources.length };
}

export async function publicItemSnapshotRequestResult(
  rawId: string,
): Promise<SnapshotCachedResult> {
  const parsed = parsePositiveRouteId(rawId);
  if (!parsed.ok) return { ok: false, error: parsed.error, status: 400 };
  const reader = publicSnapshotReader();
  const scoped = await reader.readReleaseScoped(async (scope) => {
    if (!supportsDirectItemRead(scope.release)) {
      return publicItemSnapshotResult(
        await scope.readCanonicalState(),
        rawId,
        reader,
      );
    }

    const item = (await readItemShard(scope, parsed.id)).find(
      ({ id }) => id === parsed.id,
    );
    if (!item) return { ok: false, error: "not_found", status: 404 } as const;
    const [sources, events, bodyMd] = await Promise.all([
      readSourceShard(scope),
      item.eventId === null
        ? Promise.resolve([])
        : readEventShard(scope, item.eventId),
      readItemBodyShard(scope, item.id),
    ]);
    const source =
      sources.find(({ id }) => id === item.sourceId) ??
      scope.rejectRelease(new Error(`missing public source: ${item.sourceId}`));
    const event =
      item.eventId === null
        ? null
        : events.find(({ id }) => id === item.eventId) ?? null;
    if (
      item.eventId !== null &&
      (!event || !event.memberItemIds.includes(item.id))
    ) {
      return scope.rejectRelease(
        new Error(`missing public event: ${item.eventId}`),
      );
    }
    return publicItemEntityResult(
      scope.release,
      item,
      source,
      event,
      bodyMd,
    );
  });
  return scoped.value;
}

export async function publicItemSnapshotResult(
  snapshot: PublicCanonicalStateResult,
  rawId: string,
  reader: Pick<PublicSnapshotReader, "readItemBody"> = publicSnapshotReader(),
): Promise<SnapshotCachedResult> {
  const parsed = parsePositiveRouteId(rawId);
  if (!parsed.ok) return { ok: false, error: parsed.error, status: 400 };
  const index = createPublicStateIndex(snapshot.state);
  const item = index.itemsById.get(parsed.id);
  if (!item) return { ok: false, error: "not_found", status: 404 };
  const source = index.sourcesById.get(item.sourceId);
  if (!source) throw new Error(`missing public source: ${item.sourceId}`);
  const event = item.eventId === null ? null : index.eventsById.get(item.eventId);
  if (item.eventId !== null && !event) {
    throw new Error(`missing public event: ${item.eventId}`);
  }
  const bodyMd =
    item.bodyMd ?? await reader.readItemBody(snapshot.release, item.id);
  return publicItemEntityResult(
    snapshot.release,
    item,
    source,
    event ?? null,
    bodyMd,
  );
}

function publicItemEntityResult(
  release: ResolvedPublicRelease,
  item: CanonicalPublicState["items"][number],
  source: CanonicalPublicState["sources"][number],
  event: CanonicalPublicState["events"][number] | null,
  bodyMd: string | null,
): SnapshotCachedResult {
  const publicEvent =
    event && event.coverage > 1
      ? {
          cluster_id: event.id,
          coverage: event.coverage,
          tier: event.tier,
          importance: event.importance,
          first_seen_at: event.firstSeenAt,
          latest_member_at: event.latestMemberAt,
          canonical_title: { ...event.canonicalTitle },
          editor_note: { ...event.editorNote },
          editor_analysis: { ...event.editorAnalysis },
          members_url: `/api/public/events/${event.id}/members`,
        }
      : null;
  return {
    ok: true,
    signal: etagSignal({
      release: release.ref.manifestSha256,
      id: item.id,
      enriched_at: item.enrichedAt,
      commentary_at: item.commentaryAt,
      cluster_id: event?.id ?? null,
      cluster_coverage: event?.coverage ?? null,
      cluster_latest_member_at: event?.latestMemberAt ?? null,
    }),
    body: {
      id: String(item.id),
      source: {
        id: source.id,
        name_en: source.name.en,
        name_zh: source.name.zh,
        kind: source.kind,
        group: source.group,
        locale: source.locale,
        url: source.url,
      },
      title: { ...item.title },
      summary: { ...item.summary },
      editor_note: { ...item.editorNote },
      editor_analysis: { ...item.editorAnalysis },
      tags: {
        capabilities: [...item.tags.capabilities],
        entities: [...item.tags.entities],
        topics: [...item.tags.topics],
      },
      importance: item.importance,
      tier: item.tier,
      url: item.url,
      canonical_url: item.canonicalUrl,
      author: item.author,
      published_at: item.publishedAt,
      enriched_at: item.enrichedAt,
      commentary_at: item.commentaryAt,
      body_md: bodyMd,
      hkr: item.hkr ? { ...item.hkr } : null,
      event: publicEvent,
    },
  };
}

export function publicEventMembersSnapshotResult(
  snapshot: PublicCanonicalStateResult,
  req: Request,
  options: { rawId: string; defaultLocale: AppLocale; listOnly?: boolean },
): SnapshotCachedResult {
  const parsed = parseEventMemberRouteParams({
    rawId: options.rawId,
    rawLocale: new URL(req.url).searchParams.get("locale"),
    defaultLocale: options.defaultLocale,
  });
  if (!parsed.ok) return { ok: false, error: parsed.error, status: 400 };
  const payload = toEventMembersPayload(
    parsed.clusterId,
    getPublicEventMembers(snapshot.state, parsed.clusterId, parsed.locale),
  );
  return eventMembersSnapshotResult(
    snapshot.release,
    payload,
    options.listOnly,
  );
}

export async function publicEventMembersSnapshotRequestResult(
  req: Request,
  options: { rawId: string; defaultLocale: AppLocale; listOnly?: boolean },
): Promise<SnapshotCachedResult> {
  const parsed = parseEventMemberRouteParams({
    rawId: options.rawId,
    rawLocale: new URL(req.url).searchParams.get("locale"),
    defaultLocale: options.defaultLocale,
  });
  if (!parsed.ok) return { ok: false, error: parsed.error, status: 400 };

  const reader = publicSnapshotReader();
  const scoped = await reader.readReleaseScoped(async (scope) => {
    if (!supportsDirectEntityRead(scope.release)) {
      return publicEventMembersSnapshotResult(
        await scope.readCanonicalState(),
        req,
        options,
      );
    }

    const event = (await readEventShard(scope, parsed.clusterId)).find(
      ({ id }) => id === parsed.clusterId,
    );
    if (!event) {
      return eventMembersSnapshotResult(
        scope.release,
        toEventMembersPayload(parsed.clusterId, []),
        options.listOnly,
      );
    }
    const itemLogicalNames = [
      ...new Set(
        event.memberItemIds.map((id) =>
          publicEntityShardLogicalName("item", String(id)),
        ),
      ),
    ];
    const [sources, itemShards] = await Promise.all([
      readSourceShard(scope),
      Promise.all(
        itemLogicalNames.map((logicalName) =>
          readItemShardByLogicalName(scope, logicalName),
        ),
      ),
    ]);
    const memberIds = new Set(event.memberItemIds);
    const items = itemShards.flat().filter(({ id }) => memberIds.has(id));
    const itemsById = new Map(items.map((item) => [item.id, item]));
    const sourcesById = new Map(sources.map((source) => [source.id, source]));
    for (const memberId of event.memberItemIds) {
      const item =
        itemsById.get(memberId) ??
        scope.rejectRelease(new Error(`missing public event member: ${memberId}`));
      if (item.eventId !== event.id) {
        return scope.rejectRelease(
          new Error(`missing public event member: ${memberId}`),
        );
      }
      if (!sourcesById.has(item.sourceId)) {
        return scope.rejectRelease(
          new Error(`missing public source: ${item.sourceId}`),
        );
      }
    }
    const state = directReadState({ items, events: [event], sources });
    const payload = toEventMembersPayload(
      parsed.clusterId,
      publicEventMembersFromIndex(
        {
          state,
          itemsById,
          eventsById: new Map([[event.id, event]]),
          sourcesById,
        },
        parsed.clusterId,
        parsed.locale,
      ),
    );
    return eventMembersSnapshotResult(
      scope.release,
      payload,
      options.listOnly,
    );
  });
  return scoped.value;
}

function eventMembersSnapshotResult(
  release: ResolvedPublicRelease,
  payload: ReturnType<typeof toEventMembersPayload>,
  listOnly: boolean | undefined,
): SnapshotCachedResult {
  return {
    ok: true,
    signal: etagSignal({
      release: release.ref.manifestSha256,
      ...eventMembersCacheSignalParts(payload),
    }),
    body: listOnly ? toEventMembersListEnvelope(payload) : payload,
  };
}

function supportsDirectFeedRead(release: ResolvedPublicRelease): boolean {
  return (
    release.manifest.artifacts[PUBLIC_FEED_DIRECTORY_LOGICAL_NAME] !== undefined &&
    APP_LOCALES.every(
      (locale) =>
        release.manifest.artifacts[publicFeedDefaultLogicalName(locale)] !==
        undefined,
    )
  );
}

function assertCompleteFeedDirectory(
  scope: PublicReleaseReadScope,
  directory: PublicFeedDirectory,
): void {
  const declared = directory.segments.map(({ logicalName }) => logicalName).sort();
  const manifest = Object.keys(scope.release.manifest.artifacts)
    .filter((logicalName) => logicalName.startsWith("feeds/segments/"))
    .sort();
  if (
    new Set(declared).size !== declared.length ||
    declared.length !== manifest.length ||
    declared.some((logicalName, index) => logicalName !== manifest[index])
  ) {
    scope.rejectRelease(new Error("public feed directory is incomplete"));
  }
}

function supportsDirectEntityRead(release: ResolvedPublicRelease): boolean {
  return release.manifest.numericShardCount === PUBLIC_NUMERIC_SHARD_COUNT;
}

function supportsDirectItemRead(release: ResolvedPublicRelease): boolean {
  return (
    supportsDirectEntityRead(release) &&
    release.manifest.artifacts["bodies/items/00"] !== undefined
  );
}

async function readItemShard(
  scope: PublicReleaseReadScope,
  id: number,
): Promise<CanonicalPublicState["items"]> {
  return readItemShardByLogicalName(
    scope,
    publicEntityShardLogicalName("item", String(id)),
  );
}

async function readItemShardByLogicalName(
  scope: PublicReleaseReadScope,
  logicalName: string,
): Promise<CanonicalPublicState["items"]> {
  let rows: CanonicalPublicState["items"] | undefined;
  const artifact = await scope.readLogicalArtifact(logicalName, {
    validate: (bytes) => {
      const shard = parsePublicEntityShardValue(logicalName, parseJson(bytes));
      if (shard.entityType !== "item") {
        throw new Error("public item artifact has the wrong entity type");
      }
      rows = shard.entities;
    },
  });
  return artifact ? rows! : [];
}

async function readEventShard(
  scope: PublicReleaseReadScope,
  id: number,
): Promise<CanonicalPublicState["events"]> {
  const logicalName = publicEntityShardLogicalName("event", String(id));
  let rows: CanonicalPublicState["events"] | undefined;
  const artifact = await scope.readLogicalArtifact(logicalName, {
    validate: (bytes) => {
      const shard = parsePublicEntityShardValue(logicalName, parseJson(bytes));
      if (shard.entityType !== "event") {
        throw new Error("public event artifact has the wrong entity type");
      }
      rows = shard.entities;
    },
  });
  return artifact ? rows! : [];
}

async function readSourceShard(
  scope: PublicReleaseReadScope,
): Promise<CanonicalPublicState["sources"]> {
  let rows: CanonicalPublicState["sources"] | undefined;
  await scope.readLogicalArtifact("state/sources", {
    required: true,
    validate: (bytes) => {
      rows = [...parsePublicSourceRows(bytes)];
    },
  });
  return rows!;
}

async function readItemBodyShard(
  scope: PublicReleaseReadScope,
  id: number,
): Promise<string | null> {
  const logicalName = publicItemBodyShardLogicalName(String(id));
  let bodyMd: string | null | undefined;
  await scope.readLogicalArtifact(logicalName, {
    required: true,
    validate: (bytes) => {
      const shard = parsePublicItemBodyShardValue(
        logicalName,
        parseJson(bytes),
      );
      bodyMd = shard.entities.find((entity) => entity.id === id)?.bodyMd ?? null;
    },
  });
  return bodyMd!;
}

function directReadState(input: {
  items: CanonicalPublicState["items"];
  events: CanonicalPublicState["events"];
  sources: CanonicalPublicState["sources"];
}): CanonicalPublicState {
  return {
    schemaVersion: 1,
    ...input,
    newsletters: [],
    policies: [],
  };
}

function parseJson(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  map: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = next++;
      if (index >= values.length) return;
      results[index] = await map(values[index]!);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, worker),
  );
  return results;
}

export function latestDailySnapshotResult(
  snapshot: PublicCanonicalStateResult,
  req: Request,
): SnapshotCachedResult {
  const locale = parseDailyLocale(req);
  if (!locale.ok) return locale;
  const daily = getLatestPublicDaily(snapshot.state, locale.locale);
  if (!daily) return { ok: false, error: "no_daily_yet", status: 404 };
  return dailyResult(snapshot, daily);
}

export function dailyByDateSnapshotResult(
  snapshot: PublicCanonicalStateResult,
  req: Request,
  rawDate: string,
): SnapshotCachedResult {
  const date = dailyDateSchema.safeParse(rawDate);
  if (!date.success) return { ok: false, error: "invalid_date", status: 400 };
  const locale = parseDailyLocale(req);
  if (!locale.ok) return locale;
  const daily = getPublicDailyByDate(snapshot.state, date.data, locale.locale);
  if (!daily) {
    return { ok: false, error: `no_daily_for_${date.data}`, status: 404 };
  }
  return dailyResult(snapshot, daily);
}

export function dailyIndexSnapshotResult(
  snapshot: PublicCanonicalStateResult,
  req: Request,
): SnapshotCachedResult {
  const parsed = dailyIndexQuerySchema.safeParse(queryParamsRecord(req));
  if (!parsed.success) {
    return {
      ok: false,
      error: invalidQueryError(parsed.error.issues),
      status: 400,
    };
  }
  const body = listPublicDailyIndex(snapshot.state, parsed.data);
  return {
    ok: true,
    signal: etagSignal({
      release: snapshot.release.ref.manifestSha256,
      count: body.count,
      first_id: body.items[0]?.id ?? "",
      first_gen: body.items[0]?.generated_at ?? "",
      locale: parsed.data.locale,
      take: parsed.data.take,
    }),
    body,
  };
}

function parseDailyLocale(
  req: Request,
): { ok: true; locale: AppLocale } | RouteErrorResult {
  const parsed = dailyLocaleSchema.safeParse(
    new URL(req.url).searchParams.get("locale") ??
      DEFAULT_DAILY_COLUMN_QUERY_LOCALE,
  );
  return parsed.success
    ? { ok: true, locale: parsed.data }
    : { ok: false, error: "invalid_locale", status: 400 };
}

function dailyResult(
  snapshot: PublicCanonicalStateResult,
  body: ReturnType<typeof getLatestPublicDaily> extends infer T
    ? Exclude<T, null>
    : never,
): SnapshotCachedResult {
  return {
    ok: true,
    signal: etagSignal({
      release: snapshot.release.ref.manifestSha256,
      id: body.id,
      generated: body.generated_at,
    }),
    body,
  };
}

function toSnapshotPublicApiItem(
  story: Parameters<typeof toApiItemEventFields>[0],
  locale: AppLocale,
) {
  return {
    ...toApiItemCommonFields(story, toPublicHkr(story.hkr)),
    ...toApiItemEventFields(story, locale),
  };
}
