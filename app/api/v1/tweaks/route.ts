/**
 * /api/v1/tweaks — Bearer-gated view + mutation of user preferences +
 * watchlist terms. Mirrors /api/tweaks (cookie-gated) for agents.
 *
 * GET    → { tweaks, watchlist }
 * PATCH  → body { tweaks?, watchlist? } — either field optional
 *
 * Watchlist: full-replace array of ≤24 normalized strings, each 1..64 chars
 * after trim/lowercase/case-insensitive dedupe. This keeps the UI and agent
 * mental model simple: each PATCH sends the complete desired list, and the
 * server stores that normalized full list.
 */
import { tweaksPatchBodySchema } from "@/lib/api/tweak-requests";
import { parseJsonRequestBody } from "@/lib/api/json-body";
import {
  runV1Route,
  v1Error,
  v1Json,
  v1ServerError,
} from "@/lib/api/v1-route";
import {
  getTweaksRoutePayload,
  saveTweaksRoutePayload,
} from "@/lib/api/tweak-routes";

export async function GET(req: Request) {
  return runV1Route(req, async (user) => {
    try {
      return v1Json(await getTweaksRoutePayload(user));
    } catch (err) {
      return v1ServerError("api/v1/tweaks GET", err);
    }
  });
}

export async function PATCH(req: Request) {
  return runV1Route(req, async (user) => {
    const parsed = await parseJsonRequestBody(req, tweaksPatchBodySchema, {
      envelope: "plain",
    });
    if (!parsed.ok) return parsed.response;

    try {
      const result = await saveTweaksRoutePayload(user, parsed.data);
      if (!result.ok) return v1Error(result.error, result.status);
      return v1Json({ ok: true });
    } catch (err) {
      return v1ServerError("api/v1/tweaks PATCH", err);
    }
  });
}
