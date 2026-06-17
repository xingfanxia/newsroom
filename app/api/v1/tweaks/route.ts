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
  v1Json,
  v1RouteResult,
} from "@/lib/api/v1-route";
import {
  getTweaksRoutePayload,
  saveTweaksRoutePayload,
} from "@/lib/api/tweak-routes";

export async function GET(req: Request) {
  return runV1Route(req, async (user) => {
    return v1Json(await getTweaksRoutePayload(user));
  }, { serverErrorLabel: "api/v1/tweaks GET" });
}

export async function PATCH(req: Request) {
  return runV1Route(req, async (user) => {
    const parsed = await parseJsonRequestBody(req, tweaksPatchBodySchema, {
      envelope: "plain",
    });
    if (!parsed.ok) return parsed.response;

    const result = await saveTweaksRoutePayload(user, parsed.data);
    return v1RouteResult(result, () => v1Json({ ok: true }));
  }, { serverErrorLabel: "api/v1/tweaks PATCH" });
}
