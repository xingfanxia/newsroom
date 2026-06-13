import { requireApiToken } from "@/lib/auth/api-token";
import type { SessionUser } from "@/lib/auth/session";

type V1RouteHandler = (user: SessionUser) => Response | Promise<Response>;

export async function runV1Route(
  req: Request,
  handler: V1RouteHandler,
): Promise<Response> {
  const auth = await requireApiToken(req);
  if (auth instanceof Response) return auth;
  return handler(auth.user);
}

export function v1Json(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, init);
}

export function v1Error(
  error: string,
  status: number,
  extra: Record<string, unknown> = {},
): Response {
  return Response.json({ ...extra, error }, { status });
}

export function v1InvalidQuery(issues?: unknown): Response {
  return issues === undefined
    ? v1Error("invalid_query", 400)
    : v1Error("invalid_query", 400, { issues });
}
