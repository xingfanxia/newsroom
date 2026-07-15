import {
  createPublicStateIndex,
  publicEventMembersFromIndex,
  publicStoryFromItem,
  startOfUtcDay,
  type PublicEvent,
  type PublicItem,
  type PublicSource,
  type PublicStateIndex,
} from "@/lib/public-content/public-items";
import type {
  AppLocale,
  FeedView,
  SourceGroup,
  SourceKind,
  Story,
  VisibleItemTier,
} from "@/lib/types";

const DAY_MS = 86_400_000;

export type PublicFeedQuery = {
  tier?: VisibleItemTier;
  locale?: AppLocale;
  limit?: number;
  offset?: number;
  sourceId?: string;
  sourceGroup?: SourceGroup;
  sourceKind?: SourceKind;
  includeSourceGroup?: boolean;
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  searchText?: string;
  curatedOnly?: boolean;
  excludeSourceTags?: string[];
  includeSourceTags?: string[];
  view?: FeedView;
  hotWindowHours?: number;
  minImportance?: number;
  maxPerDay?: number;
  recentDayRescueDays?: number;
  recencyFloorDays?: number;
};

export type PublicFeedResult = {
  items: Story[];
  total: number;
  limit: number;
  offset: number;
  view: FeedView;
};

type Candidate = {
  item: PublicItem;
  event: PublicEvent | undefined;
  source: PublicSource;
  effectiveImportance: number;
  effectiveTier: VisibleItemTier;
};

export function queryPublicFeed(
  value: unknown,
  query: PublicFeedQuery = {},
  options: { nowMs: number },
): PublicFeedResult {
  assertFiniteNow(options.nowMs);
  const index = createPublicStateIndex(value);
  const limit = nonNegativeInteger(query.limit ?? 40, "limit");
  const offset = nonNegativeInteger(query.offset ?? 0, "offset");
  const view = query.view ?? "archive";
  const locale = query.locale ?? "zh";

  const filtered = index.state.items
    .map((item) => candidateFor(index, item))
    .filter((candidate) => candidate !== null)
    .filter((candidate) => matchesQuery(candidate, query, options.nowMs));

  const total = filtered.length;
  const useDayCap = query.maxPerDay !== undefined && query.maxPerDay > 0;
  const sorted = [...filtered].sort(
    useDayCap ? compareDayCapped : compareDefault,
  );
  const fetchLimit = useDayCap
    ? Math.min(Math.max(limit * 5, 200), 500)
    : limit;
  const page = sorted.slice(offset, offset + fetchLimit);
  const selected = useDayCap
    ? applyDayCap(page, nonNegativeInteger(query.maxPerDay!, "maxPerDay"), limit)
    : page;

  return {
    items: selected.map(({ item }) =>
      publicStoryFromItem(index, item, {
        locale,
        includeSourceGroup: query.includeSourceGroup,
        nowMs: options.nowMs,
        hotWindowHours: query.hotWindowHours,
      }),
    ),
    total,
    limit,
    offset,
    view,
  };
}

export function getPublicEventMembers(
  value: unknown,
  eventId: number,
  locale: AppLocale = "zh",
): NonNullable<Story["members"]> {
  return publicEventMembersFromIndex(createPublicStateIndex(value), eventId, locale);
}

function candidateFor(index: PublicStateIndex, item: PublicItem): Candidate | null {
  const event = item.eventId === null ? undefined : index.eventsById.get(item.eventId);
  if (event && event.leadItemId !== item.id) return null;
  const source = index.sourcesById.get(item.sourceId);
  if (!source) throw new Error(`missing public source: ${item.sourceId}`);
  return {
    item,
    event,
    source,
    effectiveImportance: event?.importance ?? item.importance,
    effectiveTier: event?.tier ?? item.tier,
  };
}

function matchesQuery(
  candidate: Candidate,
  query: PublicFeedQuery,
  nowMs: number,
): boolean {
  const { item, event, source, effectiveImportance, effectiveTier } = candidate;
  const tier = query.tier ?? "featured";
  if (!matchesTier(effectiveTier, tier)) return false;

  if (query.sourceId) {
    if (item.sourceId !== query.sourceId) return false;
  } else {
    if (query.sourceGroup && source.group !== query.sourceGroup) return false;
    if (query.sourceKind && source.kind !== query.sourceKind) return false;
  }

  if (query.curatedOnly && !source.curated) return false;
  if (overlaps(source.tags, query.excludeSourceTags)) return false;
  if (
    query.includeSourceTags?.length &&
    !overlaps(source.tags, query.includeSourceTags)
  ) {
    return false;
  }

  const publishedMs = Date.parse(item.publishedAt);
  if (!matchesDateBounds(publishedMs, query, nowMs, event)) return false;
  if (
    query.recencyFloorDays !== undefined &&
    query.recencyFloorDays > 0 &&
    !hasExplicitDateBound(query) &&
    publishedMs < nowMs - query.recencyFloorDays * DAY_MS
  ) {
    return false;
  }

  if (query.searchText && !matchesSearch(candidate, query.searchText)) {
    return false;
  }

  if (query.minImportance !== undefined && query.minImportance > 0) {
    const rescueDays = query.recentDayRescueDays ?? 0;
    const rescued =
      rescueDays > 0 &&
      publishedMs >= startOfUtcDay(nowMs) - (rescueDays - 1) * DAY_MS;
    if (effectiveImportance < query.minImportance && !rescued) return false;
  }

  return true;
}

function matchesTier(
  effective: VisibleItemTier,
  requested: VisibleItemTier,
): boolean {
  if (requested === "p1") return effective === "p1";
  if (requested === "featured") {
    return effective === "featured" || effective === "p1";
  }
  return true;
}

function matchesDateBounds(
  publishedMs: number,
  query: PublicFeedQuery,
  nowMs: number,
  event: PublicEvent | undefined,
): boolean {
  if (query.date) {
    const start = parseDay(query.date);
    return publishedMs >= start && publishedMs < start + DAY_MS;
  }
  if (query.dateFrom || query.dateTo) {
    const from = query.dateFrom ? parseTimestamp(query.dateFrom, "dateFrom") : 0;
    const to = query.dateTo
      ? parseTimestamp(query.dateTo, "dateTo")
      : Date.parse("2999-01-01T00:00:00.000Z");
    return publishedMs >= from && publishedMs < to;
  }
  if ((query.view ?? "archive") !== "today") return true;

  const startToday = startOfUtcDay(nowMs);
  const hotWindowMs = (query.hotWindowHours ?? 24) * 3_600_000;
  return (
    (event !== undefined && Date.parse(event.firstSeenAt) >= startToday) ||
    (event !== undefined &&
      event.latestMemberAt !== null &&
      Date.parse(event.latestMemberAt) > nowMs - hotWindowMs) ||
    publishedMs >= startToday - DAY_MS
  );
}

function matchesSearch(candidate: Candidate, searchText: string): boolean {
  const { item, event } = candidate;
  const pattern = sqliteLikePattern(`%${searchText}%`);
  return [
    item.title.raw,
    item.title.zh,
    item.title.en,
    item.summary.zh,
    item.summary.en,
    event?.canonicalTitle.zh,
    event?.canonicalTitle.en,
  ].some((value) => value !== null && value !== undefined && pattern.test(asciiFold(value)));
}

function sqliteLikePattern(pattern: string): RegExp {
  let source = "^";
  for (const character of asciiFold(pattern)) {
    if (character === "%") source += "[\\s\\S]*";
    else if (character === "_") source += "[\\s\\S]";
    else source += escapeRegex(character);
  }
  return new RegExp(`${source}$`);
}

function asciiFold(value: string): string {
  return value.replace(/[A-Z]/g, (character) => character.toLowerCase());
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function overlaps(left: readonly string[], right: readonly string[] | undefined): boolean {
  return Boolean(right?.some((value) => left.includes(value)));
}

function compareDefault(left: Candidate, right: Candidate): number {
  return (
    right.item.publishedAt.localeCompare(left.item.publishedAt) ||
    right.effectiveImportance - left.effectiveImportance ||
    right.item.id - left.item.id
  );
}

function compareDayCapped(left: Candidate, right: Candidate): number {
  return (
    right.item.publishedAt.slice(0, 10).localeCompare(left.item.publishedAt.slice(0, 10)) ||
    right.effectiveImportance - left.effectiveImportance ||
    right.item.publishedAt.localeCompare(left.item.publishedAt) ||
    right.item.id - left.item.id
  );
}

function applyDayCap(
  candidates: Candidate[],
  maxPerDay: number,
  limit: number,
): Candidate[] {
  if (limit === 0) return [];
  const counts = new Map<string, number>();
  const selected: Candidate[] = [];
  for (const candidate of candidates) {
    const day = candidate.item.publishedAt.slice(0, 10);
    const count = counts.get(day) ?? 0;
    if (count >= maxPerDay) continue;
    counts.set(day, count + 1);
    selected.push(candidate);
    if (selected.length >= limit) break;
  }
  return selected;
}

function hasExplicitDateBound(query: PublicFeedQuery): boolean {
  return Boolean(query.date || query.dateFrom || query.dateTo);
}

function parseDay(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError(`invalid date: ${value}`);
  }
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) {
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

function assertFiniteNow(nowMs: number): void {
  if (!Number.isFinite(nowMs)) throw new TypeError("nowMs must be finite");
}
