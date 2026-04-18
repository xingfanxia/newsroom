import { eq } from "drizzle-orm";
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
 * GET /api/admin/iterations/[id]
 *
 * Fetches a single iteration-run row so the admin UI can poll status (useful
 * if we later move to a fire-and-forget background kick-off). Admin-only.
 */
export async function GET(
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

  const [row] = await db()
    .select()
    .from(iterationRuns)
    .where(eq(iterationRuns.id, id))
    .limit(1);
  if (!row) {
    return NextResponse.json(
      { ok: false, error: "not_found" },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, run: row });
}
