/**
 * L1 self-check for daily column drafts.
 * Pure function; no IO. Mechanical banned-phrase scanner only.
 *
 * Voice was rebased away from khazix-pure (no colons / no em-dashes / no
 * quotes) toward "professional newsletter with personality" — punctuation
 * rules dropped because Stratechery-register English/Chinese needs them
 * for proper structure. Phrase scanner survives because corporate AI-slop
 * clichés (说白了 / 综上所述 / 本质上) are universally bad regardless of
 * register.
 */

const L1_BANNED_PHRASES = [
  "说白了",
  "意味着什么",
  "这意味着",
  "本质上",
  "换句话说",
  "不可否认",
  "综上所述",
  "总的来说",
  "不难发现",
  "让我们来看看",
  "接下来让我们",
  "在当今",
  "随着技术",
  "这给我们的启示",
];

export type ColumnDraft = {
  title: string;
  summary_md: string;
  narrative_md: string;
};

export type SelfCheckHit = {
  layer: "l1" | "l2";
  rule: string;
  snippet: string;
};

export type SelfCheckResult = {
  l1Pass: boolean;
  l2Pass: boolean;
  hits: SelfCheckHit[];
};

export function runColumnSelfCheck(draft: ColumnDraft): SelfCheckResult {
  const hits: SelfCheckHit[] = [];
  const fullText = `${draft.title}\n${draft.summary_md}\n${draft.narrative_md}`;

  for (const phrase of L1_BANNED_PHRASES) {
    const idx = fullText.indexOf(phrase);
    if (idx !== -1) {
      hits.push({
        layer: "l1",
        rule: phrase,
        snippet: fullText.slice(
          Math.max(0, idx - 15),
          idx + phrase.length + 15,
        ),
      });
    }
  }

  return {
    l1Pass: !hits.some((h) => h.layer === "l1"),
    l2Pass: true,
    hits,
  };
}
