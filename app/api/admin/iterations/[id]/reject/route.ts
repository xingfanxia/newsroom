import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { iterationRuns } from "@/db/schema";
import { requireAdminForRoute } from "@/lib/api/admin-auth";
import { parseIterationRunRouteId } from "@/lib/policy/iterations";

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
  const auth = await requireAdminForRoute();
  if (!auth.ok) return auth.response;

  const { id: rawId } = await params;
  const parsedId = parseIterationRunRouteId(rawId);
  if (!parsedId.ok) {
    return NextResponse.json(
      { ok: false, error: parsedId.error },
      { status: 400 },
    );
  }
  const { id } = parsedId;

  const [updated] = await db()
    .update(iterationRuns)
    .set({ status: "rejected", completedAt: new Date() })
    .where(and(eq(iterationRuns.id, id), eq(iterationRuns.status, "proposed")))
    .returning();

  if (!updated) {
    return NextResponse.json(
      { ok: false, error: "not_proposable" },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true });
}
