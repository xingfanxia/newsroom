import { z } from "zod";
import {
  adminJson,
  adminServerError,
  runAdminRoute,
} from "@/lib/api/admin-route";
import { parseJsonRequestBody } from "@/lib/api/json-body";
import { commitSkillVersion } from "@/lib/policy/skill";

const bodySchema = z.object({
  skillName: z.string().min(1).max(64),
  content: z.string().min(1).max(64_000),
  reasoning: z.string().max(2_000).optional(),
});

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
    const parsed = await parseJsonRequestBody(req, bodySchema, { envelope: "ok" });
    if (!parsed.ok) return parsed.response;

    try {
      const row = await commitSkillVersion({
        skillName: parsed.data.skillName,
        content: parsed.data.content,
        reasoning: parsed.data.reasoning ?? null,
        feedbackSample: null,
        feedbackCount: 0,
        committedBy: user.email,
      });
      return adminJson({ version: row.version });
    } catch (err) {
      return adminServerError("api/admin/policy/commit", err);
    }
  });
}
