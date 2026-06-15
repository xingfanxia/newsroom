import {
  adminError,
  adminJson,
  runAdminRoute,
} from "@/lib/api/admin-route";
import { applyIterationRunRoutePayload } from "@/lib/api/iteration-routes";
import { parseIterationRunRouteId } from "@/lib/policy/iterations";

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
  return runAdminRoute(async (admin) => {
    const { id: rawId } = await params;
    const parsedId = parseIterationRunRouteId(rawId);
    if (!parsedId.ok) return adminError(parsedId.error, 400);

    const result = await applyIterationRunRoutePayload(admin, parsedId.id);
    if (!result.ok) return adminError(result.error, result.status, result.extra);
    return adminJson(result.payload);
  });
}
