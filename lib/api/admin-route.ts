import { requireAdminForRoute } from "@/lib/api/admin-auth";
import type { SessionUser } from "@/lib/auth/session";

type AdminRouteHandler = (admin: SessionUser) => Response | Promise<Response>;

export async function runAdminRoute(
  handler: AdminRouteHandler,
): Promise<Response> {
  const auth = await requireAdminForRoute();
  if (!auth.ok) return auth.response;
  return handler(auth.admin);
}

export function adminJson(
  body: Record<string, unknown>,
  init?: ResponseInit,
): Response {
  return Response.json({ ok: true, ...body }, init);
}

export function adminOk(init?: ResponseInit): Response {
  return Response.json({ ok: true }, init);
}

export function adminError(
  error: string,
  status: number,
  extra: Record<string, unknown> = {},
): Response {
  return Response.json({ ok: false, ...extra, error }, { status });
}
