import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { iterationRuns } from "@/db/schema";
import { requireAdminForRoute } from "@/lib/api/admin-auth";
import { parseIterationRunRouteId } from "@/lib/policy/iterations";

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
