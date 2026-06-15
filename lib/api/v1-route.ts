import { requireApiToken } from "@/lib/auth/api-token";
import type { SessionUser } from "@/lib/auth/session";
import type { QueryParseResult } from "@/lib/api/query-params";

type V1RouteHandler = (user: SessionUser) => Response | Promise<Response>;
type V1InvalidQueryResult<T> =
  | { ok: true; data: T }
  | { ok: false; response: Response };
export type V1RouteResult<T = undefined> =
  | { ok: true; payload: T }
  | { ok: true; payload?: undefined }
  | {
      ok: false;
      error: string;
      status: number;
      extra?: Record<string, unknown>;
    };

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

export function v1RouteResult<T>(
  result: V1RouteResult<T>,
  onOk: (payload: T) => Response,
): Response {
  if (!result.ok) {
    return v1Error(result.error, result.status, result.extra);
  }
  return onOk(("payload" in result ? result.payload : undefined) as T);
}

export function v1InvalidQuery(issues?: unknown): Response {
  return issues === undefined
    ? v1Error("invalid_query", 400)
    : v1Error("invalid_query", 400, { issues });
}

export function v1InvalidQueryResult<T>(
  parsed: QueryParseResult<T>,
  opts: { includeIssues?: boolean } = {},
): V1InvalidQueryResult<T> {
  if (parsed.ok) return parsed;
  return {
    ok: false,
    response: v1InvalidQuery(
      opts.includeIssues === false ? undefined : parsed.issues,
    ),
  };
}

export function v1ServerError(label: string, err: unknown): Response {
  console.error(`[${label}] failed`, err);
  return v1Error("server_error", 500);
}
