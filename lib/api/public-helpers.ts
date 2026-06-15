/**
 * Shared helpers for /api/public/* — anonymous, ETag-aware, CORS-open
 * read-only JSON surfaces.
 *
 * Public route files should enter through `publicCachedRoute(...)` so the
 * anonymous HTTP surface keeps one rate-limit, ETag/cache, and error envelope.
 * Lower-level helpers remain exported for focused tests and the rare route
 * that needs to assemble the envelope manually.
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
import { invalidQueryError } from "@/lib/api/query-params";
import { publicRateLimit } from "@/lib/rate-limit/public";

type PublicCachedJsonArgs = {
  endpoint: PublicEndpointKey;
  etagFamily: string;
  signal: string;
  body: unknown;
};

export type PublicCachedRouteResult =
  | { ok: true; signal: string; body: unknown }
  | { ok: false; error: string; status: number };

type PublicCachedRouteArgs = {
  endpoint: PublicEndpointKey;
  etagFamily: string;
  label: string;
  load: () => PublicCachedRouteResult | Promise<PublicCachedRouteResult>;
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

function publicEndpointRateLimit(
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

export async function publicCachedRoute(
  req: Request,
  { endpoint, etagFamily, label, load }: PublicCachedRouteArgs,
): Promise<Response> {
  const limited = publicEndpointRateLimit(req, endpoint);
  if (limited) return limited;

  try {
    const result = await load();
    if (!result.ok) return publicError(result.error, result.status);
    return publicCachedJson(req, {
      endpoint,
      etagFamily,
      signal: result.signal,
      body: result.body,
    });
  } catch (err) {
    return publicServerError(label, err);
  }
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

export function publicServerError(label: string, err: unknown): Response {
  console.error(`[${label}] failed`, err);
  return publicError("server_error", 500);
}

export function publicInvalidQuery(issues: readonly unknown[]): Response {
  return publicError(invalidQueryError(issues), 400);
}

export function publicInvalidQueryResult(
  issues: readonly unknown[],
): PublicCachedRouteResult {
  return { ok: false, error: invalidQueryError(issues), status: 400 };
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
