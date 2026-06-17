/**
 * Shared domain-result contracts for HTTP route adapters.
 *
 * Route payload helpers return these typed results; surface-specific adapters
 * decide whether failures become ok-enveloped admin/session responses, plain
 * JSON errors, public cached errors, or bearer v1 errors.
 */
export type RouteErrorResult = {
  ok: false;
  error: string;
  status: number;
  extra?: Record<string, unknown>;
};

export type RouteSuccessResult<T = undefined> =
  | { ok: true; payload: T }
  | { ok: true; payload?: undefined };

export type RouteResult<T = undefined> =
  | RouteSuccessResult<T>
  | RouteErrorResult;

export type RequiredPayloadRouteResult<T> =
  | { ok: true; payload: T }
  | RouteErrorResult;

export function routeResultPayload<T>(result: RouteSuccessResult<T>): T {
  return ("payload" in result ? result.payload : undefined) as T;
}
