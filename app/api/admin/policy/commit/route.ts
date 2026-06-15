import {
  adminJson,
  adminServerError,
  runAdminRoute,
} from "@/lib/api/admin-route";
import { parseJsonRequestBody } from "@/lib/api/json-body";
import {
  commitPolicyRoutePayload,
  policyCommitBodySchema,
} from "@/lib/api/policy-commit";

/**
 * POST /api/admin/policy/commit — human-authored policy update. Shortcuts
 * the agent loop for quick fixes. Writes a new `policy_versions` row with
 * `committed_by = user.email`, bumping the monotonic version.
 *
 * Intentionally separate from /api/admin/iterations/apply — that path is
 * owned by the agent and carries proposal metadata. This one is direct.
 */
export async function POST(req: Request) {
  return runAdminRoute(async (user) => {
    const parsed = await parseJsonRequestBody(req, policyCommitBodySchema, {
      envelope: "ok",
    });
    if (!parsed.ok) return parsed.response;

    try {
      return adminJson(await commitPolicyRoutePayload(user, parsed.data));
    } catch (err) {
      return adminServerError("api/admin/policy/commit", err);
    }
  });
}
