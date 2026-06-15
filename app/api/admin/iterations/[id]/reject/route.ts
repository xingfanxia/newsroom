import {
  rejectIterationRunRoutePayload,
  runAdminIterationIdRoute,
} from "@/lib/api/iteration-routes";

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
  return runAdminIterationIdRoute(params, (id) =>
    rejectIterationRunRoutePayload(id),
  );
}
