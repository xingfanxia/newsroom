import { requireSessionForRoute } from "@/lib/api/session-auth";
import type { SessionUser } from "@/lib/auth/session";

type SessionRouteHandler = (user: SessionUser) => Response | Promise<Response>;

export async function runSessionRoute(
  handler: SessionRouteHandler,
): Promise<Response> {
  const auth = await requireSessionForRoute();
  if (!auth.ok) return auth.response;
  return handler(auth.user);
}

export function sessionJson(
  body: Record<string, unknown>,
  init?: ResponseInit,
): Response {
  return Response.json({ ok: true, ...body }, init);
}

export function sessionOk(init?: ResponseInit): Response {
  return Response.json({ ok: true }, init);
}

export function sessionError(
  error: string,
  status: number,
  extra: Record<string, unknown> = {},
): Response {
  return Response.json({ ok: false, ...extra, error }, { status });
}
