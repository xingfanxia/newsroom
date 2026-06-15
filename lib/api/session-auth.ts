import { okError } from "@/lib/api/ok-response";
import { getSessionUser, type SessionUser } from "@/lib/auth/session";

type SessionAuthError = "auth_required";

export type SessionRouteAuthResult =
  | { ok: true; user: SessionUser }
  | { ok: false; response: Response };

export function sessionAuthRequiredResponse(): Response {
  return okError("auth_required" satisfies SessionAuthError, 401);
}

export async function requireSessionForRoute(): Promise<SessionRouteAuthResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, response: sessionAuthRequiredResponse() };
  return { ok: true, user };
}
