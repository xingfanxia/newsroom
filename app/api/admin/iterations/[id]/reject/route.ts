import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { iterationRuns } from "@/db/schema";
import {
  adminError,
  adminOk,
  runAdminRoute,
} from "@/lib/api/admin-route";
import { parseIterationRunRouteId } from "@/lib/policy/iterations";
import {
  ITERATION_PROPOSED_STATUS,
  ITERATION_REJECTED_STATUS,
} from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/iterations/[id]/reject
 *
 * Marks a proposed iteration as rejected. Kept for audit — no policy row
 * is written. The admin who rejected is attributed via the status change
 * timestamp; `requestedBy` already records who kicked it off.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return runAdminRoute(async () => {
    const { id: rawId } = await params;
    const parsedId = parseIterationRunRouteId(rawId);
    if (!parsedId.ok) return adminError(parsedId.error, 400);
    const { id } = parsedId;

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

    if (!updated) return adminError("not_proposable", 400);
    return adminOk();
  });
}
