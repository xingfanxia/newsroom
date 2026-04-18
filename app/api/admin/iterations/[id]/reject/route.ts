import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { iterationRuns } from "@/db/schema";
import {
  ForbiddenError,
  UnauthorizedError,
  requireAdmin,
} from "@/lib/auth/session";

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
  try {
    await requireAdmin();
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
