/**
 * L1-L2 self-check for daily column drafts.
 *
 * Pure function; no IO. Mechanical scanner only — does NOT replace human
 * editorial review (L4 活人感 cannot be automated reliably).
 *
 * Voice history (latest at top):
 * - 2026-06-10: rebased to friend-sharing voice: plain, specific, accurate,
 *   and low on translationese / report-speak.
 * - 2026-05-08 (retired): khazix narrative with AI HOT as the reference voice.
 * - 2026-04-25 (retired): Stratechery / 虎嗅周报 framing.
 *
 * The L1 phrases here are universal corporate-AI-slop clichés (说白了 /
 * 综上所述 / 本质上) — they're bad in any register. L2 catches structural
 * violations specific to the current friend-sharing format.
 */

const L1_BANNED_PHRASES = [
  // Universal AI slop
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
  "随着AI的",
  "众所周知",
  "毋庸置疑",
  // Marketing verbs
  "赋能",
  "助力",
  "引领",
  "重塑",
  "开启新篇章",
  "深度加持",
  "引爆",
  // Era clichés
  "近日",
  "近期",
  "据了解",
  "据报道",
];

// Meta-commentary openers — these signal "I'm about to discuss X" instead of
// directly giving the judgment. The current voice wants the judgment itself,
// not the meta-narration. Detection: phrase appears at the start of a paragraph
// (after \n\n or as the first sentence of summary_md/narrative_md).
const L2_META_COMMENTARY_OPENERS = [
  "先把这几个缺口摆明",
  "先把缺口摆明",
  "我对这条的判断很直接",
  "我的判断很直接",
  "拿外部参照看",
  "拿历史参照看",
  "我有一个比较大的疑虑",
  "我有一个疑虑",
  "这一轮也说明一个现实",
  "这件事也说明一个现实",
  "这件事也告诉我们",
];

// Phrases that, when used multiple times, signal repeated-disclosure padding.
// The friend-sharing voice allows a few disclosures across a full daily, but
// repeated "body did not disclose X" padding makes the column unreadable.
const L2_REPEAT_THRESHOLD_PHRASES = [
  "正文未披露",
  "正文没披露",
  "正文没给",
  "标题未披露",
  "标题没披露",
  "上游没说清楚",
  "the post does not disclose",
];

const L2_REPEAT_MAX_OCCURRENCES = 4; // daily column spans 6-10 sections; ≤4 leaves headroom while still catching padding

// Maximum sentences per paragraph. > 6 sentences is too dense for the current
// voice and must be split. Sentences detected by 。 / ！/ ？/ . / ! / ?
const L2_MAX_SENTENCES_PER_PARAGRAPH = 6;

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

/** Count sentences in a paragraph by terminating punctuation. */
function countSentences(paragraph: string): number {
  // Match Chinese 。 ！ ？and ASCII . ! ? as sentence terminators. Strip
  // url-fragments first so dots in hostnames don't inflate the count.
  const stripped = paragraph
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\[[^\]]*\]\([^)]*\)/g, ""); // markdown link bodies
  const matches = stripped.match(/[。！？.!?]/g);
  return matches ? matches.length : 0;
}

export function runColumnSelfCheck(draft: ColumnDraft): SelfCheckResult {
  const hits: SelfCheckHit[] = [];
  const fullText = `${draft.title}\n${draft.summary_md}\n${draft.narrative_md}`;

  // ── L1: banned phrases ─────────────────────────────────────────
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

  // ── L2a: meta-commentary openers ───────────────────────────────
  // Check if any of these appear at the start of a paragraph (after \n\n
  // or as the very first non-whitespace text in summary/narrative).
  const paragraphs = [
    ...draft.summary_md.split(/\n{2,}/),
    ...draft.narrative_md.split(/\n{2,}/),
  ].map((p) => p.trim());
  for (const para of paragraphs) {
    if (!para) continue;
    // Compare against the first ~30 chars of the paragraph (after stripping
    // ## headings and leading punctuation).
    const head = para.replace(/^#+\s*/, "").slice(0, 40);
    for (const opener of L2_META_COMMENTARY_OPENERS) {
      if (head.includes(opener)) {
        hits.push({
          layer: "l2",
          rule: `meta-commentary opener: "${opener}"`,
          snippet: head.slice(0, 60),
        });
        break; // only flag once per paragraph
      }
    }
  }

  // ── L2b: repeated disclosure padding ───────────────────────────
  for (const phrase of L2_REPEAT_THRESHOLD_PHRASES) {
    const matches = fullText.split(phrase).length - 1;
    if (matches > L2_REPEAT_MAX_OCCURRENCES) {
      hits.push({
        layer: "l2",
        rule: `repeated disclosure: "${phrase}" appears ${matches}× (max ${L2_REPEAT_MAX_OCCURRENCES})`,
        snippet: `(${matches}×) ${phrase}`,
      });
    }
  }

  // ── L2c: paragraph-length check ────────────────────────────────
  // Iterate narrative paragraphs; flag any with > 6 sentences.
  for (const para of draft.narrative_md.split(/\n{2,}/)) {
    const trimmed = para.trim();
    if (!trimmed || trimmed.startsWith("#")) continue; // skip headings + empties
    if (trimmed.startsWith(">")) continue; // blockquotes are pasted source quotes; let them be
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) continue; // list bullets — small-signals section uses these
    const sentenceCount = countSentences(trimmed);
    if (sentenceCount > L2_MAX_SENTENCES_PER_PARAGRAPH) {
      hits.push({
        layer: "l2",
        rule: `paragraph too dense: ${sentenceCount} sentences (max ${L2_MAX_SENTENCES_PER_PARAGRAPH})`,
        snippet: trimmed.slice(0, 80) + (trimmed.length > 80 ? "…" : ""),
      });
    }
  }

  return {
    l1Pass: !hits.some((h) => h.layer === "l1"),
    l2Pass: !hits.some((h) => h.layer === "l2"),
    hits,
  };
}
