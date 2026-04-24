#!/usr/bin/env bun
/**
 * Backtest harness for the tuned clustering parameters.
 *
 * Answers the operator-gate question from DESIGN.md §10: under the new
 * threshold (0.80) and window (±72h), what would newly merge that doesn't
 * merge today, and is the spot-check sample editorially sound?
 *
 * Strategy: instead of replaying the full clustering algorithm against a
 * shadow schema (the workers write back to live tables, so a clean shadow
 * would require deep refactoring), we use pgvector's HNSW index directly.
 * For each item in the window, we ask the index for its k=3 nearest
 * neighbors. Pairs whose distance falls under the new threshold but
 * currently belong to different clusters are the "would newly merge" set.
 * That's the population the spot-check sample is drawn from and the
 * primary input to the operator gate.
 *
 * What we DON'T do here:
 *   - Run Stage B against shadow (would need a parallel arbitrate worker
 *     that writes to a shadow `clusters` table — out of scope; operator
 *     can run Stage B in production after migration and inspect the
 *     `cluster_splits` audit table).
 *   - Hand-labeled recall scoring (operator-supplied list — script just
 *     emits a template).
 *
 * Usage:
 *   bun --env-file=.env.local scripts/ops/backtest-cluster.ts
 *   bun --env-file=.env.local scripts/ops/backtest-cluster.ts \
 *     --threshold 0.80 \
 *     --window 72 \
 *     --since 2026-04-01 \
 *     --sample-size 30 \
 *     --output docs/reports/backtest-2026-04-24
 *
 * Outputs (under --output dir):
 *   cluster-diff.md         summary of would-be-new merges + delta vs current
 *   new-merges.csv          full list of new-merge pairs (one row per pair)
 *   spot-check-sample.md    sample-size random pairs, formatted for eyeball
 *   hand-labeled-recall.md  template for operator to fill in known-related pairs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import { db, closeDb } from "@/db/client";

type Args = {
  threshold: number;
  windowHours: number;
  since: string;
  sampleSize: number;
  output: string;
};

function parseArgs(argv: string[]): Args {
  let threshold = 0.8;
  let windowHours = 72;
  let since = isoDaysAgo(30);
  let sampleSize = 30;
  let output = `docs/reports/backtest-${new Date().toISOString().slice(0, 10)}`;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--threshold") threshold = Number(argv[++i]);
    else if (a === "--window") windowHours = Number(argv[++i]);
    else if (a === "--since") since = argv[++i];
    else if (a === "--sample-size") sampleSize = Number(argv[++i]);
    else if (a === "--output") output = argv[++i];
    else if (a === "--help" || a === "-h") {
      console.log(USAGE);
      process.exit(0);
    }
  }

  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    fail(`--threshold must be 0..1 (got ${threshold})`);
  }
  if (!Number.isFinite(windowHours) || windowHours <= 0) {
    fail(`--window must be > 0 (got ${windowHours})`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    fail(`--since must be YYYY-MM-DD (got ${since})`);
  }

  return { threshold, windowHours, since, sampleSize, output };
}

const USAGE = `
backtest-cluster — preview clustering under tuned params

  --threshold N     cosine similarity threshold (default 0.80)
  --window N        ±N hours window (default 72)
  --since YYYY-MM-DD  evaluate items published since (default 30 days ago)
  --sample-size N   random pairs in spot-check sample (default 30)
  --output DIR      output directory (default docs/reports/backtest-YYYY-MM-DD)
`.trim();

function fail(msg: string): never {
  console.error(msg);
  process.exit(2);
}

function isoDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 86400_000);
  return d.toISOString().slice(0, 10);
}

type NewMergeRow = {
  a_id: number;
  a_cluster: number | null;
  a_title: string;
  a_title_zh: string | null;
  a_source: string;
  a_published: string;
  b_id: number;
  b_cluster: number | null;
  b_title: string;
  b_title_zh: string | null;
  b_source: string;
  b_published: string;
  distance: number;
};

type DistributionRow = {
  bucket: string;
  pairs: number;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const distanceCutoff = 1 - args.threshold;
  const client = db();

  // The full-window cross-join over thousands of items × HNSW lateral can
  // exceed Supabase's default 60-120s statement_timeout. Bump it for this
  // session — operator-only script, not on the request path.
  await client.execute(sql`SET statement_timeout = '600s'`);

  console.log("=== Backtest configuration ===");
  console.log(`  threshold:    ${args.threshold} (distance cutoff ${distanceCutoff.toFixed(3)})`);
  console.log(`  window:       ±${args.windowHours} hours`);
  console.log(`  since:        ${args.since}`);
  console.log(`  sample size:  ${args.sampleSize}`);
  console.log(`  output:       ${args.output}\n`);

  const outputDir = resolve(args.output);
  mkdirSync(outputDir, { recursive: true });

  // Pre-flight counts.
  const preCountsRows = (await client.execute(sql`
    SELECT
      count(*)::int AS total_items,
      count(*) FILTER (WHERE embedding IS NOT NULL)::int AS embedded,
      count(*) FILTER (WHERE cluster_id IS NOT NULL)::int AS clustered,
      count(DISTINCT cluster_id)::int AS clusters
    FROM items
    WHERE published_at >= ${args.since}::date
  `)) as unknown as Array<{
    total_items: number;
    embedded: number;
    clustered: number;
    clusters: number;
  }>;
  const preCounts = preCountsRows[0];

  console.log("=== Population in window ===");
  console.log(`  total items:   ${preCounts.total_items}`);
  console.log(`  embedded:      ${preCounts.embedded}`);
  console.log(`  clustered:     ${preCounts.clustered}`);
  console.log(`  clusters:      ${preCounts.clusters}\n`);

  // Find pairs that would newly merge under the new threshold.
  // For each item in the window, get its 3 nearest neighbors via HNSW index,
  // filtered to within the time window AND below the new distance cutoff.
  // A pair is a "new merge" if the two items are in different clusters today
  // (or one is unclustered).
  console.log(`=== Searching for new-merge pairs (this may take ~30s) ===`);
  const t0 = Date.now();
  const newMergesResult = await client.execute(sql`
    WITH targets AS (
      SELECT id, embedding, published_at, cluster_id
      FROM items
      WHERE published_at >= ${args.since}::date
        AND embedding IS NOT NULL
    ),
    neighbors AS (
      SELECT
        t.id AS a_id,
        t.cluster_id AS a_cluster,
        n.id AS b_id,
        n.cluster_id AS b_cluster,
        (t.embedding <=> n.embedding) AS distance
      FROM targets t
      CROSS JOIN LATERAL (
        SELECT id, cluster_id, embedding
        FROM items
        WHERE id <> t.id
          AND embedding IS NOT NULL
          AND published_at BETWEEN
              t.published_at - make_interval(hours => ${args.windowHours})
          AND t.published_at + make_interval(hours => ${args.windowHours})
        ORDER BY embedding <=> t.embedding
        LIMIT 3
      ) n
      WHERE (t.embedding <=> n.embedding) <= ${distanceCutoff}
        AND t.id < n.id  -- dedupe (a, b) and (b, a)
    )
    SELECT
      n.a_id, n.a_cluster, n.b_id, n.b_cluster, n.distance,
      a.title AS a_title,
      a.title_zh AS a_title_zh,
      a.published_at::text AS a_published,
      sa.name_en AS a_source,
      b.title AS b_title,
      b.title_zh AS b_title_zh,
      b.published_at::text AS b_published,
      sb.name_en AS b_source
    FROM neighbors n
    JOIN items a ON a.id = n.a_id
    JOIN items b ON b.id = n.b_id
    JOIN sources sa ON sa.id = a.source_id
    JOIN sources sb ON sb.id = b.source_id
    WHERE n.a_cluster IS DISTINCT FROM n.b_cluster  -- not currently merged
    ORDER BY n.distance
  `);
  const newMerges = newMergesResult as unknown as NewMergeRow[];
  console.log(`  found ${newMerges.length} new-merge pairs in ${Date.now() - t0}ms\n`);

  // Distance distribution among new-merges (for histogram-style summary).
  const distribution: DistributionRow[] = [
    { bucket: "0.00-0.05", pairs: 0 },
    { bucket: "0.05-0.10", pairs: 0 },
    { bucket: "0.10-0.15", pairs: 0 },
    { bucket: "0.15-0.20", pairs: 0 },
    { bucket: ">0.20", pairs: 0 },
  ];
  for (const r of newMerges) {
    if (r.distance < 0.05) distribution[0].pairs++;
    else if (r.distance < 0.10) distribution[1].pairs++;
    else if (r.distance < 0.15) distribution[2].pairs++;
    else if (r.distance < 0.20) distribution[3].pairs++;
    else distribution[4].pairs++;
  }

  // Cross-source vs same-source breakdown — cross-source merges are the high-value
  // signal (event coverage); same-source are usually near-duplicates.
  let crossSource = 0;
  let sameSource = 0;
  const sourcesA = new Map<string, number>();
  for (const r of newMerges) {
    if (r.a_source === r.b_source) sameSource++;
    else crossSource++;
    sourcesA.set(r.a_source, (sourcesA.get(r.a_source) ?? 0) + 1);
  }

  // ── Write reports ─────────────────────────────────────────────────────────
  writeClusterDiff(outputDir, args, preCounts, newMerges, distribution, {
    crossSource,
    sameSource,
  });
  writeNewMergesCsv(outputDir, newMerges);
  writeSpotCheck(outputDir, args, newMerges);
  writeHandLabeledTemplate(outputDir);

  console.log("=== Reports written ===");
  console.log(`  ${outputDir}/cluster-diff.md`);
  console.log(`  ${outputDir}/new-merges.csv`);
  console.log(`  ${outputDir}/spot-check-sample.md`);
  console.log(`  ${outputDir}/hand-labeled-recall.md\n`);

  console.log("=== Operator gate (per DESIGN.md §10) ===");
  console.log("  [ ] Spot-check sample passes eyeball (no obvious false merges)");
  console.log("  [ ] Hand-labeled recall: ≥16/20 pairs (fill in hand-labeled-recall.md)");
  console.log("  [ ] Cross-source ratio looks healthy (high cross/same is the goal)");
  console.log(`  →  cross-source new merges: ${crossSource}`);
  console.log(`  →  same-source new merges:  ${sameSource}`);
  if (sameSource > crossSource * 2) {
    console.log("\n  ⚠ same-source dominates new merges — threshold may be too loose");
    console.log("    consider --threshold 0.82 to cut near-duplicate noise");
  }

  await closeDb();
}

function writeClusterDiff(
  dir: string,
  args: Args,
  pre: { total_items: number; embedded: number; clustered: number; clusters: number },
  newMerges: NewMergeRow[],
  distribution: DistributionRow[],
  bySource: { crossSource: number; sameSource: number },
): void {
  const lines = [
    `# Cluster diff — backtest`,
    ``,
    `**Run:** ${new Date().toISOString()}  `,
    `**Window:** ±${args.windowHours}h, **Threshold:** ${args.threshold}, **Since:** ${args.since}`,
    ``,
    `## Population in window`,
    ``,
    `| Metric | Count |`,
    `|---|---|`,
    `| total items | ${pre.total_items} |`,
    `| embedded | ${pre.embedded} |`,
    `| currently clustered | ${pre.clustered} |`,
    `| current clusters | ${pre.clusters} |`,
    ``,
    `## New-merge pairs under tuned params`,
    ``,
    `**Total new-merge pairs:** ${newMerges.length}`,
    ``,
    `These are pairs of items that are NOT in the same cluster today but would merge under threshold ${args.threshold} / window ±${args.windowHours}h.`,
    ``,
    `### Distance distribution`,
    ``,
    `| Distance bucket | Pairs |`,
    `|---|---|`,
    ...distribution.map((d) => `| ${d.bucket} | ${d.pairs} |`),
    ``,
    `### Source-of-merge breakdown`,
    ``,
    `| Type | Count | Note |`,
    `|---|---|---|`,
    `| cross-source | ${bySource.crossSource} | high-value: event coverage across publishers |`,
    `| same-source | ${bySource.sameSource} | usually near-duplicates from the same feed |`,
    ``,
    `## Interpretation`,
    ``,
    `- Cross-source ratio of ≥ 50% means the threshold is catching real cross-publisher event signal.`,
    `- If same-source > 2× cross-source, threshold may be too loose; try \`--threshold 0.82\`.`,
    `- See \`spot-check-sample.md\` for a randomized eyeball check.`,
    ``,
  ];
  writeFileSync(resolve(dir, "cluster-diff.md"), lines.join("\n"));
}

function writeNewMergesCsv(dir: string, newMerges: NewMergeRow[]): void {
  const header = [
    "a_id",
    "a_cluster",
    "a_source",
    "a_published",
    "a_title",
    "b_id",
    "b_cluster",
    "b_source",
    "b_published",
    "b_title",
    "distance",
  ].join(",");

  const rows = newMerges.map((r) =>
    [
      r.a_id,
      r.a_cluster ?? "",
      csvEscape(r.a_source),
      r.a_published,
      csvEscape(r.a_title_zh ?? r.a_title),
      r.b_id,
      r.b_cluster ?? "",
      csvEscape(r.b_source),
      r.b_published,
      csvEscape(r.b_title_zh ?? r.b_title),
      r.distance.toFixed(4),
    ].join(","),
  );

  writeFileSync(resolve(dir, "new-merges.csv"), [header, ...rows].join("\n"));
}

function csvEscape(s: string): string {
  if (s == null) return "";
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeSpotCheck(
  dir: string,
  args: Args,
  newMerges: NewMergeRow[],
): void {
  const sample = randomSample(newMerges, args.sampleSize);
  const lines = [
    `# Spot-check sample — backtest`,
    ``,
    `${sample.length} random new-merge pairs (of ${newMerges.length}). Eyeball each: are these the same real-world event, or accidental similarity?`,
    ``,
    `**Operator gate:** if any obvious false merges → tighten threshold and re-run.`,
    ``,
    `---`,
    ``,
    ...sample.flatMap((r, idx) => [
      `## Pair ${idx + 1} — distance ${r.distance.toFixed(4)}`,
      ``,
      `**Item A** (${r.a_source}, ${r.a_published}, cluster=${r.a_cluster ?? "—"})  `,
      `${r.a_title_zh ?? r.a_title}  `,
      r.a_title_zh ? `_${r.a_title}_` : ``,
      ``,
      `**Item B** (${r.b_source}, ${r.b_published}, cluster=${r.b_cluster ?? "—"})  `,
      `${r.b_title_zh ?? r.b_title}  `,
      r.b_title_zh ? `_${r.b_title}_` : ``,
      ``,
      `Verdict: [ ] same event  [ ] false merge`,
      ``,
      `---`,
      ``,
    ]),
  ];
  writeFileSync(resolve(dir, "spot-check-sample.md"), lines.join("\n"));
}

function writeHandLabeledTemplate(dir: string): void {
  const lines = [
    `# Hand-labeled recall test`,
    ``,
    `**Operator instructions:** list 20 pairs of items you _know_ should be in the same event (e.g. OpenAI release covered by both their blog and HN, GPT-5 launch covered by Bloomberg and TechCrunch). Use \`item.id\` from the production DB.`,
    ``,
    `Then run:`,
    `\`\`\`bash`,
    `bun --env-file=.env.local scripts/ops/backtest-recall-check.ts \\\\`,
    `  --pairs hand-labeled-recall.md`,
    `\`\`\``,
    ``,
    `(That secondary script does not exist yet — write it after this template is filled. It just queries each pair, computes their cosine distance, and reports merge-or-not under \`--threshold\`.)`,
    ``,
    `## Pairs`,
    ``,
    `<!-- Format: \`a_id, b_id, # description\` -->`,
    ``,
    `| a_id | b_id | Description |`,
    `|---|---|---|`,
    `| ? | ? | (example) GPT-5 launch — OpenAI blog + HN frontpage |`,
    `| ? | ? | (example) Anthropic funding — TechCrunch + Bloomberg |`,
    ``,
    `**Gate:** ≥ 16/20 of the listed pairs must be \`merged\` under the configured threshold.`,
    ``,
  ];
  writeFileSync(resolve(dir, "hand-labeled-recall.md"), lines.join("\n"));
}

function randomSample<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr.slice();
  const out: T[] = [];
  const used = new Set<number>();
  while (out.length < n) {
    const idx = Math.floor(Math.random() * arr.length);
    if (used.has(idx)) continue;
    used.add(idx);
    out.push(arr[idx]);
  }
  return out;
}

main().catch(async (err) => {
  console.error("Backtest failed:", err);
  await closeDb();
  process.exit(1);
});
