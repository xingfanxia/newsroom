/**
 * Line-level structural diff + narrative-diff builder for skill revisions.
 *
 * Two complementary views:
 *   1. diffLines(base, proposed) — LCS-based unified-style line diff, used
 *      when an admin wants to audit what literally changed in the markdown.
 *   2. narrativeDiff(proposal) — agent-authored prose bullets mapped onto
 *      the UI DiffViewer (add = "what changed", remove = "what I held back"),
 *      matching the mock shape in lib/mock/iterations.ts.
 *
 * The narrative view is what `/admin/iterations` renders by default — it
 * matches the "edit patterns, not cases" framing in editorial.skill.md's
 * "Iteration discipline" section.
 */
import type { DiffLine } from "@/lib/types";
import type { IterationProposal } from "@/workers/agent/prompt";

export type { DiffLine };

/** LCS-based line diff. O(n*m) — fine for skill files well under 10k lines. */
export function diffLines(
  base: string,
  proposed: string,
  contextLines = 2,
): DiffLine[] {
  const a = base.split("\n");
  const b = proposed.split("\n");
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const raw: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      raw.push({ kind: "context", content: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      raw.push({ kind: "remove", content: a[i] });
      i++;
    } else {
      raw.push({ kind: "add", content: b[j] });
      j++;
    }
  }
  while (i < n) raw.push({ kind: "remove", content: a[i++] });
  while (j < m) raw.push({ kind: "add", content: b[j++] });

  return collapseContext(raw, contextLines);
}

function collapseContext(lines: DiffLine[], n: number): DiffLine[] {
  if (n < 0) n = 0;
  const changes: number[] = [];
  for (let k = 0; k < lines.length; k++) {
    if (lines[k].kind !== "context") changes.push(k);
  }
  if (changes.length === 0) return [];
  const keep = new Set<number>();
  for (const idx of changes) {
    for (let k = -n; k <= n; k++) {
      const target = idx + k;
      if (target >= 0 && target < lines.length) keep.add(target);
    }
  }
  const out: DiffLine[] = [];
  let last = -2;
  for (let k = 0; k < lines.length; k++) {
    if (!keep.has(k) && lines[k].kind === "context") continue;
    if (k !== last + 1 && out.length > 0) {
      out.push({ kind: "meta", content: "..." });
    }
    out.push(lines[k]);
    last = k;
  }
  return out;
}

/**
 * Narrative diff: map an agent proposal's `changeSummary` + `didNotChange`
 * onto the DiffViewer shape. This is what the admin sees as the default
 * review view. Unlike diffLines(), this is editorial prose, not a textual
 * file diff — the agent narrates its intent, not its patches.
 */
export function narrativeDiff(
  proposal: Pick<IterationProposal, "changeSummary" | "didNotChange">,
  labels: { changes: string; heldBack: string },
): DiffLine[] {
  const out: DiffLine[] = [];
  out.push({ kind: "meta", content: `### ${labels.changes}` });
  out.push({ kind: "context", content: "" });
  for (const raw of proposal.changeSummary.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line.length === 0) {
      out.push({ kind: "context", content: "" });
    } else {
      out.push({ kind: "add", content: line });
    }
  }
  if (proposal.didNotChange.length > 0) {
    out.push({ kind: "context", content: "" });
    out.push({ kind: "meta", content: `### ${labels.heldBack}` });
    out.push({ kind: "context", content: "" });
    for (const entry of proposal.didNotChange) {
      out.push({
        kind: "remove",
        content: `- ${entry.item}（${entry.reason}）`,
      });
    }
  }
  return out;
}
