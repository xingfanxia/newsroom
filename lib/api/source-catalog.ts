import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { sources, sourceHealth } from "@/db/schema";
import { toIsoStringOrNull } from "@/lib/time/relative";
import type { SourceHealthStatus } from "@/lib/types";

type SourceCatalogOrder = "priority" | "id";

const DEFAULT_SOURCE_HEALTH_STATUS = "pending" satisfies SourceHealthStatus;

type ActiveSourcePickerRow = Pick<
  SourceCatalogRow,
  "id" | "nameEn" | "nameZh" | "kind" | "group" | "locale"
>;

type ActiveSourcesRoutePayload = {
  sources: ReturnType<typeof toActiveSourcePickerItem>[];
  total: number;
};

export async function listSourceCatalogRows(
  order: SourceCatalogOrder = "priority",
) {
  const rows = await db()
    .select({
      id: sources.id,
      nameEn: sources.nameEn,
      nameZh: sources.nameZh,
      url: sources.url,
      kind: sources.kind,
      group: sources.group,
      locale: sources.locale,
      cadence: sources.cadence,
      priority: sources.priority,
      tags: sources.tags,
      enabled: sources.enabled,
      curated: sources.curated,
      notes: sources.notes,
      status: sourceHealth.status,
      lastFetchedAt: sourceHealth.lastFetchedAt,
      lastSuccessAt: sourceHealth.lastSuccessAt,
      consecutiveFailures: sourceHealth.consecutiveFailures,
      lastItemsCount: sourceHealth.lastItemsCount,
      totalItemsCount: sourceHealth.totalItemsCount,
      lastError: sourceHealth.lastError,
    })
    .from(sources)
    .leftJoin(sourceHealth, eq(sources.id, sourceHealth.sourceId))
    .orderBy(
      ...(order === "id"
        ? [asc(sources.id)]
        : [asc(sources.priority), asc(sources.id)]),
    );

  return rows;
}

export type SourceCatalogRow = Awaited<
  ReturnType<typeof listSourceCatalogRows>
>[number];

async function listActiveSourcePickerRows(): Promise<
  ActiveSourcePickerRow[]
> {
  return db()
    .select({
      id: sources.id,
      nameEn: sources.nameEn,
      nameZh: sources.nameZh,
      kind: sources.kind,
      group: sources.group,
      locale: sources.locale,
    })
    .from(sources)
    .where(eq(sources.enabled, true))
    .orderBy(asc(sources.group), asc(sources.nameEn));
}

export async function getActiveSourcesRoutePayload(): Promise<
  ActiveSourcesRoutePayload
> {
  const rows = await listActiveSourcePickerRows();
  return {
    sources: rows.map(toActiveSourcePickerItem),
    total: rows.length,
  };
}

export function toActiveSourcePickerItem(r: ActiveSourcePickerRow) {
  return {
    id: r.id,
    name_en: r.nameEn,
    name_zh: r.nameZh,
    kind: r.kind,
    group: r.group,
    locale: r.locale,
  };
}

export function toV1SourceApiItem(r: SourceCatalogRow) {
  return {
    id: r.id,
    name_en: r.nameEn,
    name_zh: r.nameZh,
    url: r.url,
    kind: r.kind,
    group: r.group,
    locale: r.locale,
    cadence: r.cadence,
    priority: r.priority,
    tags: r.tags,
    enabled: r.enabled,
    notes: r.notes,
    health: {
      status: r.status ?? DEFAULT_SOURCE_HEALTH_STATUS,
      last_fetched_at: toIsoStringOrNull(r.lastFetchedAt),
      last_success_at: toIsoStringOrNull(r.lastSuccessAt),
      consecutive_failures: r.consecutiveFailures ?? 0,
      last_items_count: r.lastItemsCount ?? 0,
      total_items_count: r.totalItemsCount ?? 0,
      last_error: r.lastError,
    },
  };
}

export function toPublicSourceApiItem(r: SourceCatalogRow) {
  return {
    id: r.id,
    name_en: r.nameEn,
    name_zh: r.nameZh,
    url: r.url,
    kind: r.kind,
    group: r.group,
    locale: r.locale,
    cadence: r.cadence,
    priority: r.priority,
    tags: r.tags,
    enabled: r.enabled,
    curated: r.curated ?? false,
    health: {
      status: r.status ?? DEFAULT_SOURCE_HEALTH_STATUS,
      last_success_at: toIsoStringOrNull(r.lastSuccessAt),
      consecutive_failures: r.consecutiveFailures ?? 0,
      total_items_count: r.totalItemsCount ?? 0,
    },
  };
}

export function toMcpSourceApiItem(r: SourceCatalogRow) {
  return {
    id: r.id,
    name_en: r.nameEn,
    name_zh: r.nameZh,
    kind: r.kind,
    group: r.group,
    cadence: r.cadence,
    enabled: r.enabled,
    status: r.status ?? DEFAULT_SOURCE_HEALTH_STATUS,
    last_success_at: toIsoStringOrNull(r.lastSuccessAt),
    consecutive_failures: r.consecutiveFailures ?? 0,
    total_items: r.totalItemsCount ?? 0,
  };
}
