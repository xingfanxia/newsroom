import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { iterationRuns } from "@/db/schema";
import {
  ForbiddenError,
  UnauthorizedError,
  requireAdmin,
} from "@/lib/auth/session";
import { commitSkillVersion } from "@/lib/policy/skill";
import { invalidatePolicyCache } from "@/workers/enrich/policy";
import { SKILL_NAME } from "@/workers/agent/iterate";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/iterations/[id]/apply
 *
 * Commits the proposed content as a new `policy_versions` row and marks the
 * run as applied. Only iterations currently in `proposed` state can be
 * applied; double-apply is idempotent-safe via the status guard.
 *
 * Returns:
 *   200 { ok: true, version }                — applied (version = new policy version number)
 *   400 { error: "not_proposable", status }  — iteration already applied / rejected / failed
 *   404                                      — no such run id
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json(
        { ok: false, error: "auth_required" },
        { status: 401 },
      );
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json(
        { ok: false, error: "admin_required" },
        { status: 403 },
      );
    }
    throw err;
  }

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json(
      { ok: false, error: "invalid_id" },
      { status: 400 },
    );
  }

  const client = db();
  const [run] = await client
    .select()
    .from(iterationRuns)
    .where(eq(iterationRuns.id, id))
    .limit(1);
  if (!run) {
    return NextResponse.json(
      { ok: false, error: "not_found" },
      { status: 404 },
    );
  }
  if (run.status !== "proposed" || !run.proposedContent) {
    return NextResponse.json(
      {
        ok: false,
        error: "not_proposable",
        status: run.status,
      },
      { status: 400 },
    );
  }

  const committed = await commitSkillVersion({
    skillName: run.skillName,
    content: run.proposedContent,
    reasoning: run.reasoningSummary,
    feedbackSample: run.feedbackSample,
    feedbackCount: run.feedbackCount,
    committedBy: admin.email,
  });

  await client
    .update(iterationRuns)
    .set({ status: "applied", completedAt: new Date() })
    .where(and(eq(iterationRuns.id, id), eq(iterationRuns.status, "proposed")));

  if (run.skillName === SKILL_NAME) invalidatePolicyCache();

  return NextResponse.json({
    ok: true,
    version: committed.version,
    committedAt: committed.committedAt,
  });
}
