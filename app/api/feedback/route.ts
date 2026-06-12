import { NextResponse } from "next/server";
import { parseJsonRequestBody } from "@/lib/api/json-body";
import { requireSessionForRoute } from "@/lib/api/session-auth";
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
  const auth = await requireSessionForRoute();
  if (!auth.ok) return auth.response;
  const user = auth.user;

  const parsed = await parseJsonRequestBody(req, feedbackBodySchema, {
    envelope: "ok",
  });
  if (!parsed.ok) return parsed.response;

  try {
    const userVotes = await applyFeedbackToggle(user, parsed.data);
    return NextResponse.json({ ok: true, userVotes });
  } catch (err) {
    console.error("[api/feedback] failed", err);
    return NextResponse.json(
      { ok: false, error: "server_error" },
      { status: 500 },
    );
  }
}
