/**
 * Shared helpers for /api/public/* — anonymous, ETag-aware, CORS-open
 * read-only JSON surfaces.
 *
 * Three things every public route should call:
 *   1. publicEndpointRateLimit(req, "<endpoint-key>") — IP token bucket
 *   2. publicCachedJson(req, { endpoint, etagFamily, signal, body }) for 200/304
 *   3. publicError(...) for explicit 4xx/5xx envelopes
 *
 * Public-safe field stripping lives next to each route handler (since each
 * route's domain model is different) — but the helpers here pin CORS, cache,
 * and ETag shape so the surface stays consistent.
 */
import { createHash } from "node:crypto";
import {
  PUBLIC_CACHE_DEFAULT,
  publicCacheConfig,
  publicRateLimitConfig,
  type PublicCacheConfig,
  type PublicEndpointKey,
} from "@/lib/api/public-endpoint-config";
import { publicRateLimit } from "@/lib/rate-limit/public";

type PublicCachedJsonArgs = {
  endpoint: PublicEndpointKey;
  etagFamily: string;
  signal: string;
  body: unknown;
};

/** Generate `W/"<family>-<sha1[:16]>"` — weak so reverse proxies can vary. */
export function computeEtag(family: string, signal: string): string {
  const hash = createHash("sha1").update(signal).digest("hex").slice(0, 16);
  return `W/"${family}-${hash}"`;
}

/** True iff the client's If-None-Match matches our computed etag. */
export function ifNoneMatch(req: Request, etag: string): boolean {
  const inm = req.headers.get("if-none-match");
  return inm != null && inm === etag;
}

/** Headers every public response gets — CORS, cache hint, ETag. */
export function publicHeaders(
  etag: string,
  cache: PublicCacheConfig = PUBLIC_CACHE_DEFAULT,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    etag,
    "cache-control": `public, s-maxage=${cache.sMaxAge}, stale-while-revalidate=${cache.staleWhileRevalidate}`,
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "if-none-match, content-type",
    vary: "accept-language, accept",
    ...extra,
  };
}

/** 304 response — empty body, just the ETag + CORS so clients can read it. */
export function notModified(
  etag: string,
  cache: PublicCacheConfig = PUBLIC_CACHE_DEFAULT,
): Response {
  return new Response(null, {
    status: 304,
    headers: publicHeaders(etag, cache),
  });
}

/** 200 JSON response with ETag + cache headers. */
export function publicJson(
  body: unknown,
  etag: string,
  cache?: PublicCacheConfig,
): Response {
  return Response.json(body, {
    status: 200,
    headers: {
      ...publicHeaders(etag, cache),
      "content-type": "application/json; charset=utf-8",
    },
  });
}

export function publicEndpointRateLimit(
  req: Request,
  endpoint: PublicEndpointKey,
): Response | null {
  return publicRateLimit(req, publicRateLimitConfig(endpoint));
}

export function publicCachedJson(
  req: Request,
  { endpoint, etagFamily, signal, body }: PublicCachedJsonArgs,
): Response {
  const etag = computeEtag(etagFamily, signal);
  const cache = publicCacheConfig(endpoint);
  if (ifNoneMatch(req, etag)) return notModified(etag, cache);
  return publicJson(body, etag, cache);
}

/** 4xx error — CORS-open so the browser can read the body. */
export function publicError(message: string, status: number): Response {
  return Response.json(
    { error: message },
    {
      status,
      headers: {
        "access-control-allow-origin": "*",
        "content-type": "application/json; charset=utf-8",
      },
    },
  );
}

/**
 * Build an ETag signal from a "what changed" tuple. Conventional usage:
 *   etagSignal({ count, firstId, lastUpdated })
 * — anything that mutates when new content lands.
 */
export function etagSignal(parts: Record<string, string | number | null>): string {
  return Object.entries(parts)
    .map(([k, v]) => `${k}=${v ?? ""}`)
    .join("|");
}
