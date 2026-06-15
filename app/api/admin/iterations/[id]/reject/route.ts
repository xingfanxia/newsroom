import {
  adminError,
  adminOk,
  runAdminRoute,
} from "@/lib/api/admin-route";
import { rejectIterationRunRoutePayload } from "@/lib/api/iteration-routes";
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
  return runAdminRoute(async () => {
    const { id: rawId } = await params;
    const parsedId = parseIterationRunRouteId(rawId);
    if (!parsedId.ok) return adminError(parsedId.error, 400);

    const result = await rejectIterationRunRoutePayload(parsedId.id);
    if (!result.ok) return adminError(result.error, result.status);
    return adminOk();
  });
}
