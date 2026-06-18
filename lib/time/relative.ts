import type { AppLocale } from "@/lib/types";

export type DateLike = Date | string | null | undefined;

type TimeOptions = {
  now?: Date;
  nullLabel?: string;
};

type LocaleTimeOptions = TimeOptions & {
  locale: AppLocale;
};

type CoarseTimeOptions = TimeOptions & {
  currentLabel?: string;
  hourSuffix?: string;
  daySuffix?: string;
  rounding?: "floor" | "round";
};

export type FeedItemTimeParts = {
  hh: string;
  date: string;
  ago: string;
};

export type RelativeTimeToken =
  | { kind: "justNow" }
  | { kind: "minutes"; value: number }
  | { kind: "hours"; value: number }
  | { kind: "days"; value: number };

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function coerceDate(value: DateLike): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function latestDate(...values: DateLike[]): Date | null {
  let latest: Date | null = null;
  for (const value of values) {
    const date = coerceDate(value);
    if (!date) continue;
    if (!latest || date > latest) latest = date;
  }
  return latest;
}

export function toIsoStringOrNull(value: DateLike): string | null {
  return coerceDate(value)?.toISOString() ?? null;
}

export function formatCompactRelativeTime(
  value: DateLike,
  options: TimeOptions = {},
): string {
  const date = coerceDate(value);
  if (!date) return options.nullLabel ?? "—";

  const ms = elapsedMs(date, options.now);
  const s = Math.round(ms / SECOND_MS);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(ms / MINUTE_MS);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(ms / HOUR_MS);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(ms / DAY_MS);
  return `${d}d ago`;
}

export function formatCoarseRelativeTime(
  value: DateLike,
  options: CoarseTimeOptions = {},
): string {
  const date = coerceDate(value);
  if (!date) return options.nullLabel ?? "—";

  const round = options.rounding === "round" ? Math.round : Math.floor;
  const h = round(elapsedMs(date, options.now) / HOUR_MS);
  if (h < 1) return options.currentLabel ?? "now";
  if (h < 24) return `${h}${options.hourSuffix ?? "h"} ago`;
  const d = round(h / 24);
  return `${d}${options.daySuffix ?? "d"} ago`;
}

export function formatFeedItemTime(
  value: DateLike,
  options: TimeOptions = {},
): FeedItemTimeParts {
  const date = coerceDate(value);
  if (!date) {
    const fallback = options.nullLabel ?? "—";
    return { hh: fallback, date: fallback, ago: fallback };
  }

  return {
    hh: date.toTimeString().slice(0, 5),
    date: `${String(date.getMonth() + 1).padStart(2, "0")}·${String(date.getDate()).padStart(2, "0")}`,
    ago: formatCoarseRelativeTime(date, options),
  };
}

export function formatLocalizedRelativeTime(
  value: DateLike,
  options: LocaleTimeOptions,
): string {
  const date = coerceDate(value);
  if (!date) return options.nullLabel ?? "—";

  const zh = options.locale === "zh";
  const mins = Math.floor(elapsedMs(date, options.now) / MINUTE_MS);
  if (mins < 1) return zh ? "刚刚" : "just now";
  if (mins < 60) return zh ? `${mins}分钟前` : `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return zh ? `${hrs}小时前` : `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return zh ? `${days}天前` : `${days}d ago`;
}

export function relativeTimeToken(
  value: DateLike,
  options: TimeOptions = {},
): RelativeTimeToken {
  const date = coerceDate(value);
  if (!date) return { kind: "justNow" };

  const seconds = Math.floor(elapsedMs(date, options.now) / SECOND_MS);
  if (seconds < 60) return { kind: "justNow" };
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return { kind: "minutes", value: minutes };
  const hours = Math.floor(seconds / 3600);
  if (hours < 24) return { kind: "hours", value: hours };
  return { kind: "days", value: Math.floor(seconds / 86400) };
}

export function formatElapsedSince(
  value: DateLike,
  options: TimeOptions = {},
): string {
  const date = coerceDate(value);
  if (!date) return options.nullLabel ?? "—";

  const ms = elapsedMs(date, options.now);
  const d = Math.floor(ms / DAY_MS);
  const h = Math.floor((ms % DAY_MS) / HOUR_MS);
  if (d > 0) return `${d}d ${h}h`;
  return `${h}h`;
}

function elapsedMs(date: Date, now = new Date()): number {
  return Math.max(0, now.getTime() - date.getTime());
}
