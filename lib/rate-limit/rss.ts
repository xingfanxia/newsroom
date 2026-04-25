/**
 * Per-IP token bucket rate limiter for RSS endpoints.
 * Vercel-instance-local: each serverless instance keeps its own buckets, which
 * means the limit compounds across cold starts. That's acceptable for this
 * use case — RSS pollers typically the same IP on the same instance, and the
 * goal is just to discourage pathological scraping, not airtight throttling.
 */

const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 60;

const buckets = new Map<string, { count: number; resetAt: number }>();

export function rssRateLimit(req: Request): Response | null {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";
  const now = Date.now();
  const bucket = buckets.get(ip);

  if (!bucket || bucket.resetAt < now) {
    buckets.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return null;
  }

  if (bucket.count >= MAX_PER_WINDOW) {
    return new Response("rate limited", {
      status: 429,
      headers: {
        "Retry-After": Math.ceil((bucket.resetAt - now) / 1000).toString(),
      },
    });
  }

  bucket.count++;
  return null;
}

/** Test-only — clear all buckets between tests. */
export function __resetRateLimitBuckets(): void {
  buckets.clear();
}
