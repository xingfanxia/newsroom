import { NextResponse } from "next/server";
import {
  ForbiddenError,
  UnauthorizedError,
  requireAdmin,
  type SessionUser,
} from "@/lib/auth/session";

type AdminAuthError = "auth_required" | "admin_required";

export type AdminRouteAuthResult =
  | { ok: true; admin: SessionUser }
  | { ok: false; response: NextResponse };

export function adminAuthErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof UnauthorizedError) {
    return NextResponse.json(
      { ok: false, error: "auth_required" satisfies AdminAuthError },
      { status: 401 },
    );
  }
  if (err instanceof ForbiddenError) {
    return NextResponse.json(
      { ok: false, error: "admin_required" satisfies AdminAuthError },
      { status: 403 },
    );
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
