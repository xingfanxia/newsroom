import { NextResponse } from "next/server";
import { getSessionUser, type SessionUser } from "@/lib/auth/session";

type SessionAuthError = "auth_required";

export type SessionRouteAuthResult =
  | { ok: true; user: SessionUser }
  | { ok: false; response: NextResponse };

export function sessionAuthRequiredResponse(): NextResponse {
  return NextResponse.json(
    { ok: false, error: "auth_required" satisfies SessionAuthError },
    { status: 401 },
  );
}

export async function requireSessionForRoute(): Promise<SessionRouteAuthResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, response: sessionAuthRequiredResponse() };
  return { ok: true, user };
}
