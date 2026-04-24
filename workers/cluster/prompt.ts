/**
 * Shared prompts for cluster-stage LLM calls.
 * Stage C: canonical event title generation.
 */

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
