import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { iterationRuns, type IterationRun } from "@/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import { commitSkillVersion } from "@/lib/policy/skill";
import {
  ITERATION_APPLIED_STATUS,
  ITERATION_PROPOSED_STATUS,
  ITERATION_REJECTED_STATUS,
} from "@/lib/types";
import { SKILL_NAME } from "@/workers/agent/iterate";
import { invalidatePolicyCache } from "@/workers/enrich/policy";

type IterationRouteError =
  | { ok: false; error: "not_found"; status: 404; extra?: undefined }
  | {
      ok: false;
      error: "not_proposable";
      status: 400;
      extra?: { status: string };
    };

type IterationRouteResult<T = Record<string, never>> =
  | { ok: true; payload: T }
  | IterationRouteError;

export async function getIterationRunRoutePayload(
  id: number,
): Promise<IterationRouteResult<{ run: IterationRun }>> {
  const [run] = await db()
    .select()
    .from(iterationRuns)
    .where(eq(iterationRuns.id, id))
    .limit(1);

  return run
    ? { ok: true, payload: { run } }
    : { ok: false, error: "not_found", status: 404 };
}

export async function applyIterationRunRoutePayload(
  admin: Pick<SessionUser, "email">,
  id: number,
): Promise<
  IterationRouteResult<{ version: number; committedAt: Date }>
> {
  const client = db();
  const [run] = await client
    .select()
    .from(iterationRuns)
    .where(eq(iterationRuns.id, id))
    .limit(1);

  if (!run) return { ok: false, error: "not_found", status: 404 };
  if (run.status !== ITERATION_PROPOSED_STATUS || !run.proposedContent) {
    return {
      ok: false,
      error: "not_proposable",
      status: 400,
      extra: { status: run.status },
    };
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

  return {
    ok: true,
    payload: {
      version: committed.version,
      committedAt: committed.committedAt,
    },
  };
}

export async function rejectIterationRunRoutePayload(
  id: number,
): Promise<IterationRouteResult> {
  const [updated] = await db()
    .update(iterationRuns)
    .set({ status: ITERATION_REJECTED_STATUS, completedAt: new Date() })
    .where(
      and(
        eq(iterationRuns.id, id),
        eq(iterationRuns.status, ITERATION_PROPOSED_STATUS),
      ),
    )
    .returning();

  return updated
    ? { ok: true, payload: {} }
    : { ok: false, error: "not_proposable", status: 400 };
}
