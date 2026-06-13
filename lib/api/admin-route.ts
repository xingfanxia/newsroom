import { requireAdminForRoute } from "@/lib/api/admin-auth";
import { okEmpty, okError, okJson } from "@/lib/api/ok-response";
import type { SessionUser } from "@/lib/auth/session";

type AdminRouteHandler = (admin: SessionUser) => Response | Promise<Response>;

export async function runAdminRoute(
  handler: AdminRouteHandler,
): Promise<Response> {
  const auth = await requireAdminForRoute();
  if (!auth.ok) return auth.response;
  return handler(auth.admin);
}

export const adminJson = okJson;
export const adminOk = okEmpty;
export const adminError = okError;
