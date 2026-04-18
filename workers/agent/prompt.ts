/**
 * Editorial iteration agent — reads accumulated feedback + current skill
 * content, proposes a minimal improvement. Bound by the "Iteration
 * discipline" section inside editorial.skill.md itself: cap ±15 per
 * iteration, append heuristics with ISO date, refuse with <5 feedback, etc.
 *
 * The agent must output the FULL new skill content (not a patch) so the
 * admin UI can diff base vs proposed in one place. Keeping full-file
 * substitution also makes rollback trivial (just re-apply the prior version
 * row).
 */
import { z } from "zod";

export const MIN_FEEDBACK_TO_ITERATE = 5;

export const agentFeedbackItemSchema = z.object({
  verdict: z.enum(["up", "down"]),
  title: z.string(),
  note: z.string(),
  createdAt: z.string(),
});
export type AgentFeedbackItem = z.infer<typeof agentFeedbackItemSchema>;

const didNotChangeItem = z.object({
  item: z.string().min(8).max(240),
  reason: z.string().min(12).max(400),
});

export const iterationProposalSchema = z.object({
  /** Short public-facing narration of what the agent noticed + changed. */
  reasoningSummary: z.string().min(80).max(3000),
  /** Markdown-style bullets: each line is one change ("1. 新增 ...") or a blank separator. */
  changeSummary: z.string().min(20).max(3000),
  /**
   * Things the agent deliberately chose NOT to do. Required — the skill's
   * own iteration-discipline rule #4 mandates this. Use it to refuse
   * overfitting feedback.
   */
  didNotChange: z.array(didNotChangeItem).min(1).max(12),
  /**
   * Full new markdown content. Must preserve section order: Role → HKR →
   * Bands → Exclusions → Signals → Taxonomy → Summary → Heuristics → Discipline.
   * If fewer than MIN_FEEDBACK_TO_ITERATE feedback items were provided, return
   * the current content UNCHANGED and explain in reasoningSummary.
   */
  proposedContent: z.string().min(2000).max(24000),
});
export type IterationProposal = z.infer<typeof iterationProposalSchema>;

export const AGENT_SYSTEM = `
You are the editorial.skill.md iteration agent for AX's AI RADAR — a
Chinese-first AI industry curation service. Your job: given (a) the current
skill file and (b) recent human feedback (👍/👎 with optional notes), propose
a MINIMAL improvement to the skill file that incorporates the feedback pattern
without overfitting.

The skill file you are editing already contains your rules. Section "Iteration
discipline" is non-negotiable:
- Edit patterns, not cases. Never write "CVE-2026-2796 should score lower";
  instead write a pattern ("technical-accessibility fail") with examples.
- Preserve section order: Role → HKR → Bands → Exclusions → Signals →
  Taxonomy → Summary → Heuristics → Discipline.
- Append to "Audience-fit heuristics (learned, update with each iteration)"
  with today's ISO date. Do NOT rewrite existing dated entries unless feedback
  directly contradicts them.
- Cap any importance-band adjustment at ±15 per iteration. No reactive
  overcorrection.
- Do NOT touch taxonomy axes or provider/entity lists based on one signal —
  need ≥3 independent feedbacks.
- "didNotChange" MUST name at least one feedback item you chose not to act
  on, with the reason — the discipline rule requires this transparency move.

If fewer than ${MIN_FEEDBACK_TO_ITERATE} feedback items are provided, REFUSE
to iterate: return the current content UNCHANGED as proposedContent, say so
in reasoningSummary ("refused: insufficient signal, need ≥${MIN_FEEDBACK_TO_ITERATE}"),
and put the refusal reason in didNotChange.

Output structure:
- reasoningSummary: 1-3 short paragraphs. Narrate what patterns you saw
  across the feedback and what you chose to codify. Plain language, no
  filler, no marketing-speak. Chinese preferred (audience is zh-first).
- changeSummary: markdown-style bullet list, one change per bullet.
  Start each with a number ("1.", "2.") so the UI renders numbered items.
- didNotChange: array of {item, reason}. Each item is something a feedback
  row suggested; reason explains why you held back (overfitting / needs more
  signal / out of scope for this skill / contradicts higher-priority rule).
- proposedContent: the COMPLETE new editorial.skill.md. Full file text, not
  a diff. Keep the markdown structure, headings, tables intact. If no change
  is warranted (insufficient feedback), return the current content byte-
  identical.
`.trim();

type UserPromptInput = {
  currentContent: string;
  feedback: AgentFeedbackItem[];
  locale?: "zh" | "en";
};

export function agentUserPrompt(input: UserPromptInput): string {
  const { currentContent, feedback } = input;
  const formatted =
    feedback.length === 0
      ? "(no feedback rows — you MUST refuse)"
      : feedback
          .map((f, i) => {
            const note = f.note.trim() || "(no note)";
            return `[${i + 1}] ${f.verdict.toUpperCase()} @ ${f.createdAt}\n    标题：${f.title}\n    备注：${note}`;
          })
          .join("\n\n");
  const today = new Date().toISOString().slice(0, 10);
  return `
<current_skill>
${currentContent}
</current_skill>

<recent_feedback count="${feedback.length}" today="${today}">
${formatted}
</recent_feedback>

Propose v-next per the Iteration discipline rules. Use today (${today}) as
the ISO date when appending to "Audience-fit heuristics". If feedback.count
< ${MIN_FEEDBACK_TO_ITERATE}, refuse (return current content unchanged).
`.trim();
}
