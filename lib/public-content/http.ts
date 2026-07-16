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
import { parsePublicEntityShardValue } from "@/lib/public-content/contracts";
import { createPublicStateIndex } from "@/lib/public-content/public-items";
import {
  getPublicEventMembers,
  queryPublicFeed,
} from "@/lib/public-content/query";
import {
  PublicSnapshotUnavailableError,
  publicSnapshotReader,
  type PublicSnapshotReader,
} from "@/lib/public-content/reader";
import type { PublicCanonicalStateResult } from "@/lib/public-content/reader/types";
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
  const snapshot = await readPublicSnapshot();
  const result = queryPublicFeed(
    snapshot.state,
    feedQueryFromParams(parsed.data),
    { nowMs: Date.now() },
  );
  return {
    ok: true,
    signal: etagSignal({
      release: snapshot.release.ref.manifestSha256,
      count: result.items.length,
      total: result.total,
      first_id: result.items[0]?.id ?? "",
      latest_at: result.items[0]?.publishedAt ?? "",
      qs: parsed.search,
    }),
    body: {
      items: result.items.map((story) =>
        toSnapshotPublicApiItem(story, parsed.data.locale),
      ),
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
      release: snapshot.release.ref.manifestSha256,
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
  return {
    ok: true,
    signal: etagSignal({
      release: snapshot.release.ref.manifestSha256,
      ...eventMembersCacheSignalParts(payload),
    }),
    body: options.listOnly ? toEventMembersListEnvelope(payload) : payload,
  };
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
