import {
  ForbiddenError,
  UnauthorizedError,
  requireAdmin,
  type SessionUser,
} from "@/lib/auth/session";
import { okError } from "@/lib/api/ok-response";
import { sessionAuthRequiredResponse } from "./session-auth";

type AdminAuthError = "admin_required";

export type AdminRouteAuthResult =
  | { ok: true; admin: SessionUser }
  | { ok: false; response: Response };

export function adminAuthErrorResponse(err: unknown): Response | null {
  if (err instanceof UnauthorizedError) {
    return sessionAuthRequiredResponse();
  }
  if (err instanceof ForbiddenError) {
    return okError("admin_required" satisfies AdminAuthError, 403);
  }
  return null;
}

export async function requireAdminForRoute(): Promise<AdminRouteAuthResult> {
  try {
    return { ok: true, admin: await requireAdmin() };
  } catch (err) {
    const response = adminAuthErrorResponse(err);
    if (response) return { ok: false, response };
    throw err;
  }
}
