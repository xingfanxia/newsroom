import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { iterationRuns } from "@/db/schema";
import {
  adminError,
  adminJson,
  runAdminRoute,
} from "@/lib/api/admin-route";
import { parseIterationRunRouteId } from "@/lib/policy/iterations";
import { commitSkillVersion } from "@/lib/policy/skill";
import {
  ITERATION_APPLIED_STATUS,
  ITERATION_PROPOSED_STATUS,
} from "@/lib/types";
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
  return runAdminRoute(async (admin) => {
    const { id: rawId } = await params;
    const parsedId = parseIterationRunRouteId(rawId);
    if (!parsedId.ok) return adminError(parsedId.error, 400);
    const { id } = parsedId;

    const client = db();
    const [run] = await client
      .select()
      .from(iterationRuns)
      .where(eq(iterationRuns.id, id))
      .limit(1);
    if (!run) return adminError("not_found", 404);
    if (run.status !== ITERATION_PROPOSED_STATUS || !run.proposedContent) {
      return adminError("not_proposable", 400, { status: run.status });
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
      .set({ status: ITERATION_APPLIED_STATUS, completedAt: new Date() })
      .where(
        and(
          eq(iterationRuns.id, id),
          eq(iterationRuns.status, ITERATION_PROPOSED_STATUS),
        ),
      );

    if (run.skillName === SKILL_NAME) invalidatePolicyCache();

    return adminJson({
      version: committed.version,
      committedAt: committed.committedAt,
    });
  });
}
