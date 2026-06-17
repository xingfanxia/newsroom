import { requireSessionForRoute } from "@/lib/api/session-auth";
import { okEmpty, okError, okJson } from "@/lib/api/ok-response";
import type { SessionUser } from "@/lib/auth/session";

type SessionRouteHandler = (user: SessionUser) => Response | Promise<Response>;
type SessionRouteOptions = {
  serverErrorLabel?: string;
};
export type SessionRouteResult<T = undefined> =
  | { ok: true; payload: T }
  | { ok: true; payload?: undefined }
  | {
      ok: false;
      error: string;
      status: number;
      extra?: Record<string, unknown>;
    };

export async function runSessionRoute(
  handler: SessionRouteHandler,
  opts: SessionRouteOptions = {},
): Promise<Response> {
  const auth = await requireSessionForRoute();
  if (!auth.ok) return auth.response;
  if (!opts.serverErrorLabel) return handler(auth.user);

  try {
    return await handler(auth.user);
  } catch (err) {
    return sessionServerError(opts.serverErrorLabel, err);
  }
}

export const sessionJson = okJson;
export const sessionOk = okEmpty;
export const sessionError = okError;

export function sessionRouteResult<T>(
  result: SessionRouteResult<T>,
  onOk: (payload: T) => Response,
): Response {
  if (!result.ok) {
    return sessionError(result.error, result.status, result.extra);
  }
  return onOk(("payload" in result ? result.payload : undefined) as T);
}

export function sessionServerError(label: string, err: unknown): Response {
  console.error(`[${label}] failed`, err);
  return sessionError("server_error", 500);
}
