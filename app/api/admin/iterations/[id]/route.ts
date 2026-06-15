import {
  adminError,
  adminJson,
  runAdminRoute,
} from "@/lib/api/admin-route";
import { getIterationRunRoutePayload } from "@/lib/api/iteration-routes";
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
  return runAdminRoute(async () => {
    const { id: rawId } = await params;
    const parsedId = parseIterationRunRouteId(rawId);
    if (!parsedId.ok) return adminError(parsedId.error, 400);

    const result = await getIterationRunRoutePayload(parsedId.id);
    if (!result.ok) return adminError(result.error, result.status);
    return adminJson(result.payload);
  });
}
