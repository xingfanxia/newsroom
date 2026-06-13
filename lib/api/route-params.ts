import { z } from "zod";

export const INVALID_ROUTE_ID_ERROR = "invalid_id";

const positiveRouteIdSchema = z.coerce.number().int().positive();

export type InvalidRouteIdError = typeof INVALID_ROUTE_ID_ERROR;

export type PositiveRouteIdResult =
  | { ok: true; id: number }
  | { ok: false; error: InvalidRouteIdError };

export function parsePositiveRouteId(rawId: string): PositiveRouteIdResult {
  const parsed = positiveRouteIdSchema.safeParse(rawId);
  if (!parsed.success) {
    return { ok: false, error: INVALID_ROUTE_ID_ERROR };
  }
  return { ok: true, id: parsed.data };
}
