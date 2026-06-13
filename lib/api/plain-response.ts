/**
 * Plain JSON response helpers for small legacy/internal HTTP routes.
 *
 * Unlike `/api/public/*`, these routes do not opt into CORS, ETag, or public
 * rate-limit behavior. Unlike admin/session routes, they do not use an
 * `{ ok: ... }` envelope.
 */
export function plainJson(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, init);
}

export function plainError(error: string, status: number): Response {
  return plainJson({ error }, { status });
}

export function plainServerError(label: string, err: unknown): Response {
  console.error(`[${label}] failed`, err);
  return plainError("server_error", 500);
}
