/**
 * Shared prompts for cluster-stage LLM calls.
 * Stage B (arbitrate): given a candidate cluster's members, decide keep-or-split.
 * Stage C (canonical-title): generates canonical event name. [TODO: added by Task 2.c]
 * Stage D (event-commentary): generates event-level editor note/analysis. [TODO: added by Task 2.d]
 */

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
