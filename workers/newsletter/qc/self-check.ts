/**
 * L1-L2 self-check for daily column drafts.
 * Pure function; no IO. Mechanical scanners only — L3 (content quality) and
 * L4 (活人感) are subjective and stay manual per design 4.
 *
 * L1 — banned phrases that signal AI-tone leakage. Scan everywhere.
 * L2 — banned punctuation. Scan title + narrative_md only; summary_md
 *      gets a pass on colons because numbered list `1. title: take` is OK.
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
  "值得注意的是",
  "不难发现",
  "让我们来看看",
  "接下来让我们",
  "首先",
  "其次",
  "最后",
  "在当今",
  "随着技术",
  "这给我们的启示",
];

const L2_PUNCT: { name: string; re: RegExp }[] = [
  { name: "冒号", re: /[:：]/ },
  { name: "破折号", re: /——/ },
  { name: "双引号", re: /["“”]/ },
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
        snippet: fullText.slice(Math.max(0, idx - 15), idx + phrase.length + 15),
      });
    }
  }

  // L2 — title + narrative only; summary's numbered list allowed colons.
  const l2Scope = `${draft.title}\n${draft.narrative_md}`;
  for (const { name, re } of L2_PUNCT) {
    const m = l2Scope.match(re);
    if (m && m.index !== undefined) {
      hits.push({
        layer: "l2",
        rule: name,
        snippet: l2Scope.slice(Math.max(0, m.index - 15), m.index + 15),
      });
    }
  }

  return {
    l1Pass: !hits.some((h) => h.layer === "l1"),
    l2Pass: !hits.some((h) => h.layer === "l2"),
    hits,
  };
}
