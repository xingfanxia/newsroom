import {
  applyIterationRunRoutePayload,
  runAdminIterationIdRoute,
} from "@/lib/api/iteration-routes";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/iterations/[id]/apply
 *
 * Commits the proposed content as a new `policy_versions` row and marks the
 * run as applied. Only iterations currently in `proposed` state can be
 * applied; double-apply is idempotent-safe via the status guard.
 *
 * Returns:
 *   200 { ok: true, version }                — applied (version = new policy version number)
 *   400 { error: "not_proposable", status }  — iteration already applied / rejected / failed
 *   404                                      — no such run id
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return runAdminIterationIdRoute(params, (id, admin) =>
    applyIterationRunRoutePayload(admin, id),
  );
}
