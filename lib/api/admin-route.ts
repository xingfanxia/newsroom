import { requireAdminForRoute } from "@/lib/api/admin-auth";
import { okEmpty, okError, okJson } from "@/lib/api/ok-response";
import type { SessionUser } from "@/lib/auth/session";

type AdminRouteHandler = (admin: SessionUser) => Response | Promise<Response>;
type AdminRouteOptions = {
  serverErrorLabel?: string;
  serverErrorExtra?:
    | Record<string, unknown>
    | ((err: unknown) => Record<string, unknown>);
};
export type AdminRouteResult<T = undefined> =
  | { ok: true; payload: T }
  | { ok: true; payload?: undefined }
  | {
      ok: false;
      error: string;
      status: number;
      extra?: Record<string, unknown>;
    };

export async function runAdminRoute(
  handler: AdminRouteHandler,
  opts: AdminRouteOptions = {},
): Promise<Response> {
  const auth = await requireAdminForRoute();
  if (!auth.ok) return auth.response;
  if (!opts.serverErrorLabel) return handler(auth.admin);

  try {
    return await handler(auth.admin);
  } catch (err) {
    const extra =
      typeof opts.serverErrorExtra === "function"
        ? opts.serverErrorExtra(err)
        : (opts.serverErrorExtra ?? {});
    return adminServerError(opts.serverErrorLabel, err, extra);
  }
}

export const adminJson = okJson;
export const adminOk = okEmpty;
export const adminError = okError;

export function adminRouteResult<T>(
  result: AdminRouteResult<T>,
  onOk: (payload: T) => Response,
): Response {
  if (!result.ok) {
    return adminError(result.error, result.status, result.extra);
  }
  return onOk(("payload" in result ? result.payload : undefined) as T);
}

export function adminServerError(
  label: string,
  err: unknown,
  extra: Record<string, unknown> = {},
): Response {
  console.error(`[${label}] failed`, err);
  return adminError("server_error", 500, extra);
}
