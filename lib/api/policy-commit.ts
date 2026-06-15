import { z } from "zod";
import type { SessionUser } from "@/lib/auth/session";
import { commitSkillVersion } from "@/lib/policy/skill";

export const policyCommitBodySchema = z.object({
  skillName: z.string().min(1).max(64),
  content: z.string().min(1).max(64_000),
  reasoning: z.string().max(2_000).optional(),
});

type PolicyCommitBody = z.infer<typeof policyCommitBodySchema>;

type PolicyCommitRoutePayload = {
  version: number;
};

export async function commitPolicyRoutePayload(
  user: Pick<SessionUser, "email">,
  body: PolicyCommitBody,
): Promise<PolicyCommitRoutePayload> {
  const row = await commitSkillVersion({
    skillName: body.skillName,
    content: body.content,
    reasoning: body.reasoning ?? null,
    feedbackSample: null,
    feedbackCount: 0,
    committedBy: user.email,
  });

  return { version: row.version };
}
