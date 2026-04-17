import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import {
  applyFeedbackToggle,
  feedbackBodySchema,
} from "@/lib/feedback/toggle";

/**
 * POST /api/feedback — toggle 👍 / 👎 / ⭐ for the signed-in user.
 *
 * - 200 { ok: true, userVotes } on success
 * - 400 on invalid body (zod issues)
 * - 401 when the caller has no valid Supabase session
 * - 500 on unexpected server error (logged, not exposed)
 */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "auth_required" },
      { status: 401 },
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }

  const parsed = feedbackBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid_body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

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
