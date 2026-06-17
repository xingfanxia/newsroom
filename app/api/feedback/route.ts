import { parseJsonRequestBody } from "@/lib/api/json-body";
import {
  runSessionRoute,
  sessionJson,
} from "@/lib/api/session-route";
import {
  applyFeedbackToggle,
  feedbackBodySchema,
} from "@/lib/feedback/toggle";

/**
 * POST /api/feedback — toggle 👍 / 👎 / ⭐ for the signed-in user.
 *
 * - 200 { ok: true, userVotes } on success
 * - 400 on invalid body (zod issues)
 * - 401 when the caller has no valid session cookie
 * - 500 on unexpected server error (logged, not exposed)
 */
export async function POST(req: Request) {
  return runSessionRoute(async (user) => {
    const parsed = await parseJsonRequestBody(req, feedbackBodySchema, {
      envelope: "ok",
    });
    if (!parsed.ok) return parsed.response;

    const userVotes = await applyFeedbackToggle(user, parsed.data);
    return sessionJson({ userVotes });
  }, { serverErrorLabel: "api/feedback" });
}
