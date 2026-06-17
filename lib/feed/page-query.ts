export const FEED_PAGE_SIZE = 200;
export const FEED_DATE_DRILLDOWN_LIMIT = 500;

const FEED_DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function coerceFeedDateKey(date: string | undefined): string | undefined {
  return date && FEED_DATE_KEY_RE.test(date) ? date : undefined;
}

export function coerceFeedOffset(offset: string | undefined): number {
  const n = Number.parseInt(offset ?? "0", 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function feedPageLimitForDate(
  activeDate: string | undefined,
  pageSize = FEED_PAGE_SIZE,
): number {
  return activeDate ? FEED_DATE_DRILLDOWN_LIMIT : pageSize;
}
