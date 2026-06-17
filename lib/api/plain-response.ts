/**
 * Plain JSON response helpers for small legacy/internal HTTP routes.
 *
 * Unlike `/api/public/*`, these routes do not opt into CORS, ETag, or public
 * rate-limit behavior. Unlike admin/session routes, they do not use an
 * `{ ok: ... }` envelope.
 */
type PlainRouteHandler = () => Response | Promise<Response>;
type PlainRouteOptions = {
  serverErrorLabel?: string;
};

export function plainJson(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, init);
}

export async function runPlainRoute(
  handler: PlainRouteHandler,
  opts: PlainRouteOptions = {},
): Promise<Response> {
  if (!opts.serverErrorLabel) return handler();

  try {
    return await handler();
  } catch (err) {
    return plainServerError(opts.serverErrorLabel, err);
  }
}

export function plainError(error: string, status: number): Response {
  return plainJson({ error }, { status });
}

export type PlainRouteResult<T> =
  | { ok: true; payload: T }
  | { ok: false; error: string; status: number };

export function plainRouteResult<T>(
  result: PlainRouteResult<T>,
  onOk: (payload: T) => Response,
): Response {
  if (!result.ok) {
    return plainError(result.error, result.status);
  }
  return onOk(result.payload);
}

export function plainServerError(label: string, err: unknown): Response {
  console.error(`[${label}] failed`, err);
  return plainError("server_error", 500);
}
