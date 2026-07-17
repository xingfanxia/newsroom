/**
 * Server-rendered feed pages serialize every story into both HTML and the RSC
 * payload. Keeping a page to 50 cards holds the wire response below the
 * dynamic-page budget while archive pagination preserves full reachability.
 */
import { FEED_OFFSET_MAX } from "@/lib/feed/query-defaults";

export const FEED_PAGE_SIZE = 50;
export const FEED_DATE_DRILLDOWN_LIMIT = FEED_PAGE_SIZE;

const FEED_DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function coerceFeedDateKey(date: string | undefined): string | undefined {
  return date && FEED_DATE_KEY_RE.test(date) ? date : undefined;
}

export function coerceFeedOffset(offset: string | undefined): number {
  const n = Number.parseInt(offset ?? "0", 10);
  return Number.isSafeInteger(n) && n >= 0 && n <= FEED_OFFSET_MAX ? n : 0;
}

export function feedPageLimitForDate(
  activeDate: string | undefined,
  pageSize = FEED_PAGE_SIZE,
): number {
  return activeDate ? FEED_DATE_DRILLDOWN_LIMIT : pageSize;
}

/**
 * Keep readers safe while an older release still contains the former 200-card
 * materialized page. New publishers emit 50 cards, but application deploys and
 * public snapshot releases do not switch atomically.
 */
export function capFeedPageItems<T>(items: T[]): T[] {
  return items.length > FEED_PAGE_SIZE
    ? items.slice(0, FEED_PAGE_SIZE)
    : items;
}
