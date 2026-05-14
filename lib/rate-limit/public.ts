/**
 * Per-IP token bucket rate limiter for /api/public/* endpoints.
 *
 * Same shape as lib/rate-limit/rss.ts but parameterized so different endpoint
 * families can pick different (windowMs, max). Vercel-instance-local — buckets
 * don't survive cold starts, so the limit is "discourage hammering" not
 * "airtight cap". Good enough for anonymous public read traffic.
 *
 * Keyed on `ip + ':' + family` so a hot /feed poller doesn't burn the budget
 * for /daily on the same IP.
 */
export type RateLimitConfig = {
  /** Distinguishes endpoint families so they each get their own bucket. */
  family: string;
  windowMs: number;
  max: number;
};

/** Sensible default — matches AI HOT's 600r/min/IP. */
export const PUBLIC_RL_DEFAULT: RateLimitConfig = {
  family: "public-default",
  windowMs: 60_000,
  max: 600,
};

const buckets = new Map<string, { count: number; resetAt: number }>();

function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

export function publicRateLimit(
  req: Request,
  cfg: RateLimitConfig = PUBLIC_RL_DEFAULT,
): Response | null {
  const key = `${clientIp(req)}:${cfg.family}`;
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + cfg.windowMs });
    return null;
  }
  if (bucket.count >= cfg.max) {
    return Response.json(
      { error: "rate_limited" },
      {
        status: 429,
        headers: {
          "retry-after": Math.ceil((bucket.resetAt - now) / 1000).toString(),
          "access-control-allow-origin": "*",
        },
      },
    );
  }
  bucket.count++;
  return null;
}

/** Test-only — reset all buckets between cases. */
export function __resetPublicBuckets(): void {
  buckets.clear();
}
