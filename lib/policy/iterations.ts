/**
 * Iteration-run queries used by /admin/iterations and the API routes.
 * Kept separate from `workers/agent/iterate.ts` (the runtime) so the UI
 * doesn't pull in the LLM client just to list rows.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { iterationRuns, type IterationRun } from "@/db/schema";

/** Most recent iteration for a skill, regardless of status. */
export async function getLatestIterationRun(
  skillName: string,
): Promise<IterationRun | null> {
  const [row] = await db()
    .select()
    .from(iterationRuns)
    .where(eq(iterationRuns.skillName, skillName))
    .orderBy(desc(iterationRuns.createdAt))
    .limit(1);
  return row ?? null;
}

/** The currently-proposed iteration, if any. At most one exists in practice. */
export async function getCurrentProposal(
  skillName: string,
): Promise<IterationRun | null> {
  const [row] = await db()
    .select()
    .from(iterationRuns)
    .where(
      and(
        eq(iterationRuns.skillName, skillName),
        eq(iterationRuns.status, "proposed"),
      ),
    )
    .orderBy(desc(iterationRuns.createdAt))
    .limit(1);
  return row ?? null;
}

/** History of finished runs (applied / rejected / failed) for audit UI. */
export async function listIterationHistory(
  skillName: string,
  limit = 20,
): Promise<IterationRun[]> {
  return db()
    .select()
    .from(iterationRuns)
    .where(
      and(
        eq(iterationRuns.skillName, skillName),
        inArray(iterationRuns.status, ["applied", "rejected", "failed"]),
      ),
    )
    .orderBy(desc(iterationRuns.createdAt))
    .limit(limit);
}
