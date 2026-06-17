import { parseJsonRequestBody } from "@/lib/api/json-body";
import { feedbackMoveBodySchema } from "@/lib/api/saved-requests";
import { moveSavedItemRoutePayload } from "@/lib/api/saved-routes";
import {
  runSessionRoute,
  sessionOk,
  sessionRouteResult,
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

    const result = await moveSavedItemRoutePayload(user, parsed.data);
    return sessionRouteResult(result, () => sessionOk());
  }, { serverErrorLabel: "api/feedback/move" });
}
