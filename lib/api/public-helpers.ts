/**
 * Shared helpers for /api/public/* — anonymous, ETag-aware, CORS-open
 * read-only JSON surfaces.
 *
 * Three things every public route should call:
 *   1. publicRateLimit(req, publicRateLimitConfig("<endpoint-key>")) — IP token bucket
 *   2. computeEtag(family, signal) + ifNoneMatch(req, etag) → notModified()
 *   3. publicJson(body, etag) or publicError(...)
 *
 * Public-safe field stripping lives next to each route handler (since each
 * route's domain model is different) — but the helpers here pin CORS, cache,
 * and ETag shape so the surface stays consistent.
 */
import { createHash } from "node:crypto";
import {
  PUBLIC_CACHE_DEFAULT,
  type PublicCacheConfig,
} from "@/lib/api/public-endpoint-config";

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
export function notModified(etag: string): Response {
  return new Response(null, { status: 304, headers: publicHeaders(etag) });
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
