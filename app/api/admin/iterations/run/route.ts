import { NextResponse } from "next/server";
import {
  ForbiddenError,
  UnauthorizedError,
  requireAdmin,
} from "@/lib/auth/session";
import { IterationGuardError, runIteration } from "@/workers/agent/iterate";

export const dynamic = "force-dynamic";
// Pro+medium finishes in ~3-5 min on the current skill + 10 feedback rows;
// give the route plenty of headroom so a slow Azure response doesn't 504
// before the agent row gets persisted.
export const maxDuration = 600;

/**
 * POST /api/admin/iterations/run
 *
 * Kicks off an editorial-agent iteration. Admin-only. Synchronous — waits
 * for the pro + xhigh-reasoning call to return (typical 30-90s; maxDuration
 * set to 5 min for Vercel Fluid Compute).
 *
 * Returns:
 *   202 { runId, status, baseVersion, proposal? }  — proposal attached when status='proposed'
 *   400 { error: "insufficient_feedback", detail } — fewer than MIN_FEEDBACK_TO_ITERATE feedback rows
 *   401 / 403 — auth / admin allowlist failure
 *   500 { error, detail }                          — agent call crashed; run row has status='failed'
 */
export async function POST() {
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

  try {
    const result = await runIteration({ requestedBy: admin.email });
    if (result.status === "failed") {
      return NextResponse.json(
        {
          ok: false,
          runId: result.run.id,
          status: "failed",
          error: "agent_failed",
          detail: result.error,
        },
        { status: 500 },
      );
    }
    return NextResponse.json(
      {
        ok: true,
        runId: result.run.id,
        status: "proposed",
        baseVersion: result.run.baseVersion,
        proposal: result.proposal,
      },
      { status: 202 },
    );
  } catch (err) {
    if (err instanceof IterationGuardError) {
      return NextResponse.json(
        { ok: false, error: err.code, detail: err.message },
        { status: 400 },
      );
    }
    console.error("[api/admin/iterations/run] failed", err);
    return NextResponse.json(
      {
        ok: false,
        error: "server_error",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
