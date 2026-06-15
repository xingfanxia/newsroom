import { parseJsonRequestBody } from "@/lib/api/json-body";
import {
  runSessionRoute,
  sessionJson,
  sessionOk,
  sessionRouteResult,
  sessionServerError,
} from "@/lib/api/session-route";
import { tweaksPatchBodySchema } from "@/lib/api/tweak-requests";
import {
  getTweaksRoutePayload,
  saveTweaksRoutePayload,
} from "@/lib/api/tweak-routes";

/** GET — return the user's saved tweaks + watchlist (null when not set). */
export async function GET() {
  return runSessionRoute(async (user) => {
    try {
      return sessionJson(await getTweaksRoutePayload(user));
    } catch (err) {
      return sessionServerError("api/tweaks GET", err);
    }
  });
}

/** PATCH — save the user's tweaks / watchlist. Either field is optional. */
export async function PATCH(req: Request) {
  return runSessionRoute(async (user) => {
    const parsed = await parseJsonRequestBody(req, tweaksPatchBodySchema, {
      envelope: "ok",
    });
    if (!parsed.ok) return parsed.response;

    try {
      const result = await saveTweaksRoutePayload(user, parsed.data);
      return sessionRouteResult(result, () => sessionOk());
    } catch (err) {
      return sessionServerError("api/tweaks PATCH", err);
    }
  });
}
