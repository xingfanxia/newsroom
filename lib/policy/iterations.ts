/**
 * Iteration-run queries used by /admin/iterations and the API routes.
 * Kept separate from `workers/agent/iterate.ts` (the runtime) so the UI
 * doesn't pull in the LLM client just to list rows.
 */
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { iterationRuns, type IterationRun } from "@/db/schema";
import {
  parsePositiveRouteId,
  type PositiveRouteIdResult,
} from "@/lib/api/route-params";

export type IterationRunRouteIdResult = PositiveRouteIdResult;

export function parseIterationRunRouteId(
  rawId: string,
): IterationRunRouteIdResult {
  return parsePositiveRouteId(rawId);
}

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
