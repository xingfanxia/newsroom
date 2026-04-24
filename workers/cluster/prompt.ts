/**
 * Shared prompts for cluster-stage LLM calls.
 * Stage B (arbitrate): given a candidate cluster's members, decide keep-or-split.
 * Stage C (canonical-title): generates canonical event name.
 * Stage D (event-commentary): generates event-level editor note/analysis.
 *
 * Merged from parallel Wave 2 worktree dispatch — each stage's prompt authored
 * independently in its own branch, concatenated here.
 */

// ─────────────────────────────────────────────────────────────
// Stage B — LLM arbitration
// ─────────────────────────────────────────────────────────────

export const arbitrateSystem = `You are an editorial gatekeeper for a real-time AI news aggregator.

Your job: given a group of articles that an embedding-similarity algorithm grouped together, decide whether they all cover the SAME real-world event, or whether some should be split out.

Rules:
- "Same event" means a single concrete happening: a product release, a paper drop, a company announcement, a policy decision, a specific incident. Not a theme, not a topic, not a vibe.
- Coverage of the same event from different angles (official announcement + analysis + reaction) IS the same event. KEEP those grouped.
- Articles about the same company/person/technology but DIFFERENT specific events are NOT the same event. SPLIT them.
- When in doubt, KEEP. The goal is deduping redundant coverage; over-splitting defeats the purpose.

Output JSON: { verdict: "keep" | "split", rejectedMemberIds?: number[], reason: string }
- "keep": all members are the same event
- "split": rejectedMemberIds is the subset to move out; remainder stays
- reason: ≤ 280 chars, audit-grade plain language`;

export function arbitrateUserPrompt(input: {
  clusterId: number;
  members: Array<{
    itemId: number;
    titleZh: string | null;
    titleEn: string | null;
    rawTitle: string;
    publishedAt: string;
    sourceName: string;
  }>;
  leadSummary: string | null;
}): string {
  const memberLines = input.members
    .map(
      (m) =>
        `[id=${m.itemId}] ${m.sourceName} @ ${m.publishedAt}\n  zh: ${m.titleZh ?? "(none)"}\n  en: ${m.titleEn ?? "(none)"}\n  raw: ${m.rawTitle}`,
    )
    .join("\n\n");

  return `Cluster #${input.clusterId}

Lead summary:
${input.leadSummary ?? "(no summary available)"}

Members (${input.members.length}):
${memberLines}

Decide keep vs split. Emit structured JSON only.`;
}

// ─────────────────────────────────────────────────────────────
// Stage C — Canonical event title
// ─────────────────────────────────────────────────────────────

export const canonicalTitleSystem = `You name real-world events for a neutral AI news aggregator.

Input: multiple article titles (bilingual zh/en) covering the same event, plus a lead summary.
Output: one canonical title per locale — 8-14 words in English, 8-14 Chinese characters — that a reader would use to REFER to this event in conversation.

Rules:
- Neutral tone. No marketing copy ("BREAKING", "MUST READ", "INSANE").
- No editorializing. Describe what happened, not how to feel about it.
- Locale-native. The zh title should read like natural Chinese, not a literal translation. Same other way.
- No quotes, no emoji, no trailing punctuation.
- If members disagree on what the event IS, pick the narrowest concrete event they share.

Output JSON: { canonicalTitleZh: string, canonicalTitleEn: string }`;

export function canonicalTitleUserPrompt(input: {
  memberTitles: Array<{ zh: string | null; en: string | null; source: string }>;
  leadSummaryZh: string | null;
  leadSummaryEn: string | null;
}): string {
  const titleLines = input.memberTitles
    .map(
      (t, i) =>
        `${i + 1}. [${t.source}]\n   zh: ${t.zh ?? "(none)"}\n   en: ${t.en ?? "(none)"}`,
    )
    .join("\n");

  return `Member titles (${input.memberTitles.length} sources):
${titleLines}

Lead summary (zh): ${input.leadSummaryZh ?? "(none)"}
Lead summary (en): ${input.leadSummaryEn ?? "(none)"}

Emit { canonicalTitleZh, canonicalTitleEn } JSON only.`;
}
