import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { commitSkillVersion } from "@/lib/policy/skill";

const bodySchema = z.object({
  skillName: z.string().min(1).max(64),
  content: z.string().min(1).max(64_000),
  reasoning: z.string().max(2_000).optional(),
});

/**
 * POST /api/admin/policy/commit — human-authored policy update. Shortcuts
 * the agent loop for quick fixes. Writes a new `policy_versions` row with
 * `committed_by = user.email`, bumping the monotonic version.
 *
 * Intentionally separate from /api/admin/iterations/apply — that path is
 * owned by the agent and carries proposal metadata. This one is direct.
 */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });
  }
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid_body", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    const row = await commitSkillVersion({
      skillName: parsed.data.skillName,
      content: parsed.data.content,
      reasoning: parsed.data.reasoning ?? null,
      feedbackSample: null,
      feedbackCount: 0,
      committedBy: user.email,
    });
    return NextResponse.json({ ok: true, version: row.version });
  } catch (err) {
    console.error("[api/admin/policy/commit] failed", err);
    return NextResponse.json(
      { ok: false, error: "server_error" },
      { status: 500 },
    );
  }
}
