import {
  getIterationRunRoutePayload,
  runAdminIterationIdRoute,
} from "@/lib/api/iteration-routes";

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
  return runAdminIterationIdRoute(
    params,
    (id) => getIterationRunRoutePayload(id),
    { serverErrorLabel: "api/admin/iterations/:id GET" },
  );
}
