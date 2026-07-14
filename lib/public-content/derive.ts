import { flattenItemTags } from "@/lib/items/tags";
import { pickLocalizedText } from "@/lib/items/localized";
import { createPublicStateIndex } from "@/lib/public-content/public-items";
import {
  queryPublicFeed,
  type PublicFeedQuery,
} from "@/lib/public-content/query";
import type { AppLocale } from "@/lib/types";

const DAY_MS = 86_400_000;

export type PublicRadarStats = {
  items_today: number;
  items_p1: number;
  items_featured: number;
  tracked_sources: number;
};

export type PublicDayBucket = { date: string; count: number };
export type PublicPulsePoint = { h: number; c: number };
export type PublicTopicEntry = { tag: string; count: number; hot: boolean };

export function deriveRadarStats(
  value: unknown,
  nowMs: number,
): PublicRadarStats {
  const state = createPublicStateIndex(value).state;
  const recent = state.items.filter(
    (item) => Date.parse(item.createdAt) >= nowMs - DAY_MS,
  );
  return {
    items_today: recent.length,
    items_p1: recent.filter((item) => item.tier === "p1").length,
    items_featured: recent.filter((item) => item.tier === "featured").length,
    tracked_sources: state.sources.filter((source) => source.enabled).length,
  };
}

export function derivePulseData(
  value: unknown,
  nowMs: number,
): PublicPulsePoint[] {
  const state = createPublicStateIndex(value).state;
  const counts = new Map<number, number>();
  for (const item of state.items) {
    const createdMs = Date.parse(item.createdAt);
    if (createdMs < nowMs - DAY_MS) continue;
    const hour = new Date(createdMs).getUTCHours();
    counts.set(hour, (counts.get(hour) ?? 0) + 1);
  }
  return Array.from({ length: 24 }, (_, hour) => ({
    h: hour,
    c: counts.get(hour) ?? 0,
  }));
}

export function deriveTopTopics(
  value: unknown,
  nowMs: number,
  limit = 16,
): PublicTopicEntry[] {
  const state = createPublicStateIndex(value).state;
  const counts = new Map<string, number>();
  for (const item of state.items) {
    if (Date.parse(item.createdAt) < nowMs - 7 * DAY_MS) continue;
    for (const tag of flattenItemTags(item.tags, Number.MAX_SAFE_INTEGER)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  const rows = [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag))
    .slice(0, Math.max(0, limit));
  const peak = rows[0]?.count ?? 1;
  return rows.map((row) => ({ ...row, hot: row.count >= peak * 0.6 }));
}

export function deriveDayCounts(
  value: unknown,
  days = 30,
  query: Pick<
    PublicFeedQuery,
    "tier" | "excludeSourceTags" | "includeSourceTags" | "curatedOnly"
  > = {},
  nowMs: number,
): PublicDayBucket[] {
  if (!Number.isSafeInteger(days) || days < 0) {
    throw new TypeError("days must be a non-negative safe integer");
  }
  const result = queryPublicFeed(
    value,
    { ...query, tier: query.tier ?? "all", limit: Number.MAX_SAFE_INTEGER },
    { nowMs },
  );
  const cutoff = nowMs - days * DAY_MS;
  const counts = new Map<string, number>();
  for (const story of result.items) {
    if (Date.parse(story.publishedAt) < cutoff) continue;
    const day = story.publishedAt.slice(0, 10);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return [...counts]
    .map(([date, count]) => ({ date, count }))
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, days);
}

export function derivePodcastChannels(value: unknown): Array<{
  id: string;
  nameEn: string;
  nameZh: string;
  count: number;
}> {
  const state = createPublicStateIndex(value).state;
  return state.sources
    .filter((source) => source.group === "podcast" && source.enabled)
    .map((source) => ({
      id: source.id,
      nameEn: source.name.en ?? source.id,
      nameZh: source.name.zh ?? source.name.en ?? source.id,
      count: state.items.filter((item) => item.sourceId === source.id).length,
    }))
    .sort((left, right) => right.count - left.count || left.id.localeCompare(right.id));
}

export function deriveXHandles(value: unknown, nowMs: number): Array<{
  id: string;
  handle: string;
  nameEn: string;
  nameZh: string;
  last24h: number;
  total: number;
}> {
  const state = createPublicStateIndex(value).state;
  return state.sources
    .filter((source) => source.kind === "x-api" && source.enabled)
    .map((source) => {
      const items = state.items.filter((item) => item.sourceId === source.id);
      const match = source.url.match(/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})/i);
      const handle = match ? `@${match[1]}` : source.id;
      return {
        id: source.id,
        handle,
        nameEn: source.name.en ?? handle,
        nameZh: source.name.zh ?? handle,
        last24h: items.filter(
          (item) => Date.parse(item.createdAt) >= nowMs - DAY_MS,
        ).length,
        total: items.length,
      };
    })
    .sort(
      (left, right) =>
        right.last24h - left.last24h ||
        right.total - left.total ||
        left.id.localeCompare(right.id),
    );
}

export function deriveActiveSources(value: unknown): Array<{
  id: string;
  name_en: string;
  name_zh: string;
  kind: string;
  group: string;
  locale: string;
}> {
  const state = createPublicStateIndex(value).state;
  return state.sources
    .filter((source) => source.enabled)
    .sort(
      (left, right) =>
        left.group.localeCompare(right.group) ||
        left.name.en.localeCompare(right.name.en),
    )
    .map((source) => ({
      id: source.id,
      name_en: source.name.en,
      name_zh: source.name.zh,
      kind: source.kind,
      group: source.group,
      locale: source.locale,
    }));
}

export function deriveSourceCatalog(value: unknown): Array<{
  id: string;
  name_en: string;
  name_zh: string;
  url: string;
  kind: string;
  group: string;
  locale: string;
  cadence: string;
  priority: number;
  tags: string[];
  enabled: boolean;
  curated: boolean;
  health: {
    status: string;
    last_success_at: string | null;
    consecutive_failures: number;
    total_items_count: number;
  };
}> {
  return createPublicStateIndex(value).state.sources
    .slice()
    .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id))
    .map((source) => ({
      id: source.id,
      name_en: source.name.en,
      name_zh: source.name.zh,
      url: source.url,
      kind: source.kind,
      group: source.group,
      locale: source.locale,
      cadence: source.cadence,
      priority: source.priority,
      tags: [...source.tags],
      enabled: source.enabled,
      curated: source.curated,
      health: {
        status: source.health.status,
        last_success_at: source.health.lastSuccessAt,
        consecutive_failures: source.health.consecutiveFailures,
        total_items_count: source.health.totalItemsCount,
      },
    }));
}

export function deriveRecentTickerItems(
  value: unknown,
  locale: AppLocale,
  nowMs: number,
  limit = 12,
): Array<{ lab: string; val: string; kind?: "up" | "hot" | "down"; extra?: string }> {
  const index = createPublicStateIndex(value);
  return index.state.items
    .filter(
      (item) =>
        Date.parse(item.createdAt) >= nowMs - DAY_MS &&
        (item.tier === "featured" || item.tier === "p1"),
    )
    .sort((left, right) => right.importance - left.importance || right.id - left.id)
    .slice(0, Math.max(0, limit))
    .map((item) => {
      const source = index.sourcesById.get(item.sourceId)!;
      const title = pickLocalizedText(locale, {
        en: item.title.en,
        zh: item.title.zh,
        fallback: item.title.raw,
      })!;
      return {
        lab: (locale === "en" ? source.name.en : source.name.zh).toUpperCase().slice(0, 20),
        val: truncate(title, 44),
        kind: item.tier === "p1" ? "hot" : item.importance >= 90 ? "up" : undefined,
        extra: String(item.importance),
      };
    });
}

function truncate(value: string, length: number): string {
  return value.length <= length
    ? value
    : `${value.slice(0, length - 1).trimEnd()}…`;
}
