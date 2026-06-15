import { parseJsonRequestBody } from "@/lib/api/json-body";
import { feedbackMoveBodySchema } from "@/lib/api/saved-requests";
import { moveSavedItemRoutePayload } from "@/lib/api/saved-routes";
import {
  runSessionRoute,
  sessionError,
  sessionOk,
  sessionServerError,
} from "@/lib/api/session-route";

/**
 * POST /api/feedback/move — reparent a saved item into a named collection
 * (or back to inbox when targetCollectionId=null).
 *
 * 200 { ok:true } on success, 400 on invalid body, 401 if unauth,
 * 404 if the save doesn't exist for this user.
 */
export async function POST(req: Request) {
  return runSessionRoute(async (user) => {
    const parsed = await parseJsonRequestBody(req, feedbackMoveBodySchema, {
      envelope: "ok",
    });
    if (!parsed.ok) return parsed.response;

    try {
      const result = await moveSavedItemRoutePayload(user, parsed.data);
      if (!result.ok) return sessionError(result.error, result.status);
      return sessionOk();
    } catch (err) {
      return sessionServerError("api/feedback/move", err);
    }
  });
}
