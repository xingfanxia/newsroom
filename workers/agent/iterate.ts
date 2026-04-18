/**
 * Editorial iteration agent runtime — reads feedback + active skill, calls
 * profiles.agent (pro + xhigh reasoning), persists the proposal as an
 * `iteration_runs` row with status='proposed'. The row is the handoff to
 * the admin UI: user reviews the diff, then POST /apply commits a new
 * `policy_versions` row and the workers pick up the change next tick.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { iterationRuns, type IterationRun } from "@/db/schema";
import { getActiveSkill } from "@/lib/policy/skill";
import { getRecentFeedback } from "@/lib/feedback/metrics";
import { generateStructured, profiles } from "@/lib/llm";
import {
  AGENT_SYSTEM,
  agentUserPrompt,
  iterationProposalSchema,
  MIN_FEEDBACK_TO_ITERATE,
  type AgentFeedbackItem,
  type IterationProposal,
} from "./prompt";

export const SKILL_NAME = "editorial";
const FEEDBACK_WINDOW = 50;

export class IterationGuardError extends Error {
  constructor(
    public readonly code: "insufficient_feedback",
    message: string,
  ) {
    super(message);
    this.name = "IterationGuardError";
  }
}

export type IterationResult =
  | {
      status: "proposed";
      run: IterationRun;
      proposal: IterationProposal;
    }
  | {
      status: "failed";
      run: IterationRun;
      error: string;
    };

type RunOptions = {
  requestedBy: string;
  feedbackWindow?: number;
};

/**
 * Kick off an iteration. Throws IterationGuardError when feedback volume is
 * below the threshold (caller should surface as 400 to the admin). Any other
 * failure is captured on the run row with status='failed'.
 */
export async function runIteration(
  opts: RunOptions,
): Promise<IterationResult> {
  const client = db();
  const skill = await getActiveSkill(SKILL_NAME);
  const recent = await getRecentFeedback("zh", opts.feedbackWindow ?? FEEDBACK_WINDOW);

  if (recent.length < MIN_FEEDBACK_TO_ITERATE) {
    throw new IterationGuardError(
      "insufficient_feedback",
      `need ≥${MIN_FEEDBACK_TO_ITERATE} feedback items to iterate; have ${recent.length}`,
    );
  }

  const agentFeedback: AgentFeedbackItem[] = recent.map((r) => ({
    verdict: r.verdict,
    title: r.title,
    note: r.note,
    createdAt: r.createdAt,
  }));

  const [opened] = await client
    .insert(iterationRuns)
    .values({
      skillName: SKILL_NAME,
      status: "running",
      baseVersion: skill.version,
      feedbackSample: agentFeedback,
      feedbackCount: agentFeedback.length,
      requestedBy: opts.requestedBy,
    })
    .returning();

  try {
    const result = await generateStructured({
      ...profiles.agent,
      // Override profiles.agent's xhigh. Pro + xhigh hit Azure's 5-min
      // request ceiling with a 12KB prompt + structured output; high also
      // skirted the ceiling. Medium finishes in ~30-90s and still produces
      // judgment+pushback quality on structured editing. Dial up if output
      // quality regresses — never default to xhigh for long-context tasks.
      reasoningEffort: "medium",
      task: "agent",
      system: AGENT_SYSTEM,
      messages: [
        {
          role: "user",
          content: agentUserPrompt({
            currentContent: skill.content,
            feedback: agentFeedback,
          }),
        },
      ],
      schema: iterationProposalSchema,
      schemaName: "PolicyIterationProposal",
      // Skill file ≈ 2500 tokens + proposal prose ≈ 500 + reasoning headroom.
      // 8192 has been plenty in dry-runs; raise only if schema parse truncates.
      maxTokens: 8192,
    });
    const proposal = result.data;
    const [updated] = await client
      .update(iterationRuns)
      .set({
        status: "proposed",
        proposedContent: proposal.proposedContent,
        reasoningSummary: proposal.reasoningSummary,
        agentOutput: proposal,
        completedAt: new Date(),
      })
      .where(eq(iterationRuns.id, opened.id))
      .returning();
    return { status: "proposed", run: updated, proposal };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const [updated] = await client
      .update(iterationRuns)
      .set({
        status: "failed",
        error: message,
        completedAt: new Date(),
      })
      .where(eq(iterationRuns.id, opened.id))
      .returning();
    return { status: "failed", run: updated, error: message };
  }
}
