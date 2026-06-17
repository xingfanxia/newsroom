import { runAdminIterationStartRoute } from "@/lib/api/iteration-routes";

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
  return runAdminIterationStartRoute();
}
