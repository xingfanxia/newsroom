import { requireSessionForRoute } from "@/lib/api/session-auth";
import { okEmpty, okError, okJson } from "@/lib/api/ok-response";
import type { SessionUser } from "@/lib/auth/session";

type SessionRouteHandler = (user: SessionUser) => Response | Promise<Response>;

export async function runSessionRoute(
  handler: SessionRouteHandler,
): Promise<Response> {
  const auth = await requireSessionForRoute();
  if (!auth.ok) return auth.response;
  return handler(auth.user);
}

export const sessionJson = okJson;
export const sessionOk = okEmpty;
export const sessionError = okError;
