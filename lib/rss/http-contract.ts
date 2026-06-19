export type RssCacheConfig = {
  maxAge: number;
  sMaxAge?: number;
  staleWhileRevalidate?: number;
};

export const RSS_CONTENT_TYPE = "application/rss+xml; charset=utf-8";

export const RSS_DEFAULT_CACHE: RssCacheConfig = {
  maxAge: 600,
  sMaxAge: 600,
  staleWhileRevalidate: 3600,
};

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

export const RSS_RATE_LIMIT_WINDOW_MS = HOUR_MS;
export const RSS_RATE_LIMIT_MAX = 60;

export function rssCacheControl(
  cache: RssCacheConfig = RSS_DEFAULT_CACHE,
): string {
  const parts = ["public", `max-age=${cache.maxAge}`];
  if (cache.sMaxAge !== undefined) parts.push(`s-maxage=${cache.sMaxAge}`);
  if (cache.staleWhileRevalidate !== undefined) {
    parts.push(`stale-while-revalidate=${cache.staleWhileRevalidate}`);
  }
  return parts.join(", ");
}

export function rssRateLimitReqLabel(): string {
  if (RSS_RATE_LIMIT_WINDOW_MS === HOUR_MS) {
    return `${RSS_RATE_LIMIT_MAX} req/h`;
  }
  const minutes = RSS_RATE_LIMIT_WINDOW_MS / MINUTE_MS;
  if (Number.isInteger(minutes)) {
    return `${RSS_RATE_LIMIT_MAX} req/${minutes}m`;
  }
  return `${RSS_RATE_LIMIT_MAX} req/window`;
}
