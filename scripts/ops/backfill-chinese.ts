#!/usr/bin/env bun
/**
 * DeepSeek Chinese-only backfill.
 *
 * Rewrites GPT-generated Chinese prose while preserving English fields:
 * - items.title_zh / summary_zh
 * - items.reasoning_zh and hkr.reasonsZh
 * - items.editor_note_zh / editor_analysis_zh
 * - clusters.editor_note_zh / editor_analysis_zh
 */

import pLimit from "p-limit";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { closeDb, db } from "@/db/client";
import { clusters, items, type Item } from "@/db/schema";
import {
  generateChineseCommentary,
  generateChineseEnrichment,
  generateChineseScoreRationale,
} from "@/workers/enrich/chinese";
import {
  commentaryUserPrompt,
  type CAPABILITIES,
  type TOPICS,
  type EnrichOutput,
  type ScoreOutput,
} from "@/workers/enrich/prompt";
import {
  eventCommentaryUserPrompt,
  type EventMember,
} from "@/workers/cluster/prompt";
import { isHighlightItemTier } from "@/lib/types";
import { treatmentForScore } from "@/workers/enrich/treatment";
import {
  loadOpsState,
  opsStatePath,
  saveOpsState,
} from "@/scripts/ops/state";

type Capability = (typeof CAPABILITIES)[number];
type Topic = (typeof TOPICS)[number];
type Target = "enrich" | "score" | "commentary" | "clusters";
type BackfillItem = Pick<
  Item,
  | "id"
  | "sourceId"
  | "title"
  | "body"
  | "bodyMd"
  | "url"
  | "publishedAt"
  | "titleEn"
  | "summaryZh"
  | "summaryEn"
  | "tags"
  | "importance"
  | "tier"
  | "hkr"
  | "reasoningZh"
  | "reasoningEn"
  | "editorNoteEn"
  | "editorAnalysisEn"
>;

type Flags = {
  dryRun: boolean;
  batchSize: number;
  limit: number | null;
  targets: Set<Target>;
  resume: boolean;
};

type ChineseBackfillState = {
  enrichItems: number[];
  scoreItems: number[];
  commentaryItems: number[];
  clusters: number[];
  updatedAt: string;
};

const STATE_FILE = opsStatePath("backfill-chinese-state.json");

function parseArgs(argv: string[]): Flags {
  const flags: Flags = {
    dryRun: true,
    batchSize: 12,
    limit: null,
    targets: new Set(["enrich", "score", "commentary", "clusters"]),
    resume: false,
  };
  const next = (i: number, name: string) => {
    const v = argv[i];
    if (!v) throw new Error(`${name} requires a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") flags.dryRun = true;
    else if (a === "--apply") flags.dryRun = false;
    else if (a === "--resume") flags.resume = true;
    else if (a === "--batch-size") flags.batchSize = Number.parseInt(next(++i, a), 10);
    else if (a === "--limit") flags.limit = Number.parseInt(next(++i, a), 10);
    else if (a === "--targets") {
      const targets = next(++i, a).split(",").map((s) => s.trim()) as Target[];
      flags.targets = new Set(targets);
    } else if (a === "--help" || a === "-h") {
      console.log(`Usage: bun --env-file=.env.local scripts/ops/backfill-chinese.ts [--apply] [--dry-run] [--resume] [--batch-size 12] [--limit N] [--targets enrich,score,commentary,clusters]`);
      process.exit(0);
    } else {
      throw new Error(`unknown flag: ${a}`);
    }
  }
  if (!Number.isInteger(flags.batchSize) || flags.batchSize < 1) {
    throw new Error("--batch-size must be an integer >= 1");
  }
  if (flags.limit != null && (!Number.isInteger(flags.limit) || flags.limit < 1)) {
    throw new Error("--limit must be an integer >= 1");
  }
  return flags;
}

async function loadState(resume: boolean): Promise<ChineseBackfillState> {
  return loadOpsState<ChineseBackfillState>({
    resume,
    file: STATE_FILE,
    empty: emptyChineseBackfillState,
    normalize: normalizeChineseBackfillState,
  });
}

async function saveState(state: ChineseBackfillState): Promise<void> {
  await saveOpsState(STATE_FILE, state);
}

function emptyChineseBackfillState(): ChineseBackfillState {
  return {
    enrichItems: [],
    scoreItems: [],
    commentaryItems: [],
    clusters: [],
    updatedAt: new Date().toISOString(),
  };
}

function normalizeChineseBackfillState(
  parsed: Partial<ChineseBackfillState>,
  empty: ChineseBackfillState,
): ChineseBackfillState {
  return {
    enrichItems: parsed.enrichItems ?? [],
    scoreItems: parsed.scoreItems ?? [],
    commentaryItems: parsed.commentaryItems ?? [],
    clusters: parsed.clusters ?? [],
    updatedAt: parsed.updatedAt ?? empty.updatedAt,
  };
}

function maybeLimit<T>(rows: T[], limit: number | null): T[] {
  return limit == null ? rows : rows.slice(0, limit);
}

function tagBag(item: BackfillItem): EnrichOutput["tags"] {
  const raw = (item.tags ?? {}) as {
    capabilities?: string[];
    entities?: string[];
    topics?: string[];
  };
  return {
    capabilities: (raw.capabilities ?? []) as Capability[],
    entities: raw.entities ?? [],
    topics: (raw.topics ?? []) as Topic[],
  };
}

function scoreOutputFromItem(item: BackfillItem): ScoreOutput | null {
  const hkr = item.hkr as ScoreOutput["hkr"] | null;
  if (!hkr || item.importance == null || !item.tier || !item.reasoningEn) {
    return null;
  }
  return {
    importance: item.importance,
    tier: item.tier as ScoreOutput["tier"],
    hkr,
    reasoningZh: item.reasoningZh ?? "",
    reasoningEn: item.reasoningEn,
  };
}

function compactErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/\s+/g, " ").slice(0, 180);
}

function compactItemCommentaryPrompt(item: BackfillItem): string {
  const payload = {
    title: item.title,
    source: item.sourceId,
    url: item.url,
    publishedAt: item.publishedAt.toISOString(),
    tier: item.tier,
    importance: item.importance ?? 0,
    summaryZh: item.summaryZh ?? "",
    summaryEn: item.summaryEn ?? "",
    editorNoteEn: item.editorNoteEn ?? "",
    editorAnalysisEn: item.editorAnalysisEn ?? "",
    tags: tagBag(item),
    bodyOmitted:
      "Compact retry: original source body omitted because the provider rejected the longer prompt.",
  };
  return `Rewrite only the Chinese editor commentary for one feed item.

Use this compact JSON context. If the evidence is thin, say so plainly.

${JSON.stringify(payload, null, 2)}

Follow the requested output schema exactly.`;
}

function compactClusterCommentaryPrompt(args: {
  cluster: ClusterCandidate;
  members: EventMember[];
  richestSourceId: string;
  richestTitle: string;
}): string {
  const payload = {
    canonicalTitleZh: args.cluster.canonicalTitleZh,
    canonicalTitleEn: args.cluster.canonicalTitleEn,
    memberCount: args.cluster.memberCount,
    importance: args.cluster.importance,
    eventTier: args.cluster.eventTier,
    members: args.members.slice(0, 30),
    richestSourceId: args.richestSourceId,
    richestTitle: args.richestTitle,
    bodyOmitted:
      "Compact retry: richest article body omitted because the provider rejected the longer prompt.",
  };
  return `Rewrite only the Chinese event commentary for one multi-source cluster.

Use this compact JSON context. Compare the sources when useful, but do not invent details beyond the titles and metadata.

${JSON.stringify(payload, null, 2)}

Follow the requested output schema exactly.`;
}

const itemSelect = {
  id: items.id,
  sourceId: items.sourceId,
  title: items.title,
  body: items.body,
  bodyMd: items.bodyMd,
  url: items.url,
  publishedAt: items.publishedAt,
  titleEn: items.titleEn,
  summaryZh: items.summaryZh,
  summaryEn: items.summaryEn,
  tags: items.tags,
  importance: items.importance,
  tier: items.tier,
  hkr: items.hkr,
  reasoningZh: items.reasoningZh,
  reasoningEn: items.reasoningEn,
  editorNoteEn: items.editorNoteEn,
  editorAnalysisEn: items.editorAnalysisEn,
};

async function loadItemRows(): Promise<BackfillItem[]> {
  return db()
    .select(itemSelect)
    .from(items)
    .where(isNotNull(items.enrichedAt))
    .orderBy(desc(items.publishedAt));
}

async function loadItemCommentaryRows(): Promise<BackfillItem[]> {
  return db()
    .select(itemSelect)
    .from(items)
    .where(and(isNotNull(items.commentaryAt), isNotNull(items.editorNoteEn)))
    .orderBy(desc(items.publishedAt));
}

type ClusterCandidate = {
  id: number;
  leadItemId: number;
  canonicalTitleZh: string | null;
  canonicalTitleEn: string | null;
  memberCount: number;
  importance: number | null;
  eventTier: string | null;
};

async function loadClusterCommentaryRows(): Promise<ClusterCandidate[]> {
  return db()
    .select({
      id: clusters.id,
      leadItemId: clusters.leadItemId,
      canonicalTitleZh: clusters.canonicalTitleZh,
      canonicalTitleEn: clusters.canonicalTitleEn,
      memberCount: clusters.memberCount,
      importance: clusters.importance,
      eventTier: clusters.eventTier,
    })
    .from(clusters)
    .where(and(isNotNull(clusters.commentaryAt), isNotNull(clusters.editorNoteEn)))
    .orderBy(sql`${clusters.importance} DESC NULLS LAST`, desc(clusters.updatedAt));
}

async function rewriteEnrichment(item: BackfillItem, dryRun: boolean) {
  const treatment = treatmentForScore({
    importance: item.importance,
    tier: item.tier,
  });
  const fullInput = {
    title: item.title,
    body: item.body,
    bodyMd: item.bodyMd,
    url: item.url,
    source: item.sourceId,
    titleEn: item.titleEn,
    summaryEn: item.summaryEn,
    itemId: item.id,
    treatment,
  };
  const zh = await generateChineseEnrichment(fullInput).catch((err) => {
    console.warn(
      `[fallback] enrich item #${item.id}: compact prompt after provider error (${compactErrorMessage(err)})`,
    );
    return generateChineseEnrichment({
      ...fullInput,
      body: "",
      bodyMd: null,
    });
  });
  if (!dryRun) {
    await db()
      .update(items)
      .set({ titleZh: zh.titleZh, summaryZh: zh.summaryZh })
      .where(eq(items.id, item.id));
  }
}

async function rewriteScore(item: BackfillItem, dryRun: boolean) {
  const score = scoreOutputFromItem(item);
  if (!score) return;
  const treatment = treatmentForScore({
    importance: item.importance,
    tier: item.tier,
  });
  const input = {
    title: item.title,
    summaryZh: item.summaryZh ?? item.title,
    tags: tagBag(item),
    score,
    itemId: item.id,
    treatment,
  };
  const zh = await generateChineseScoreRationale(input).catch((err) => {
    console.warn(
      `[fallback] score item #${item.id}: compact prompt after provider error (${compactErrorMessage(err)})`,
    );
    return generateChineseScoreRationale({
      ...input,
      summaryZh: input.summaryZh.slice(0, 220),
      tags: {
        capabilities: input.tags.capabilities.slice(0, 6),
        entities: input.tags.entities.slice(0, 8),
        topics: input.tags.topics.slice(0, 6),
      },
    });
  });
  if (!dryRun) {
    await db()
      .update(items)
      .set({
        reasoningZh: zh.reasoningZh,
        hkr: {
          ...score.hkr,
          reasonsZh: zh.hkrReasonsZh,
        },
      })
      .where(eq(items.id, item.id));
  }
}

async function rewriteItemCommentary(item: BackfillItem, dryRun: boolean) {
  const full = item.editorAnalysisEn != null;
  const treatment = treatmentForScore({
    importance: item.importance,
    tier: item.tier,
  });
  const userContent = commentaryUserPrompt({
    title: item.title,
    body: item.body,
    bodyMd: item.bodyMd,
    summaryZh: item.summaryZh ?? "",
    summaryEn: item.summaryEn ?? "",
    tier: item.tier as "featured" | "p1" | "all",
    importance: item.importance ?? 0,
    tags: tagBag(item),
    url: item.url,
    source: item.sourceId,
    publishedAt: item.publishedAt.toISOString(),
  });
  const zh = await generateChineseCommentary({
    task: "commentary",
    itemId: item.id,
    userContent,
    full,
    treatment,
  }).catch((err) => {
    console.warn(
      `[fallback] commentary item #${item.id}: compact prompt after provider error (${compactErrorMessage(err)})`,
    );
    return generateChineseCommentary({
      task: "commentary",
      itemId: item.id,
      userContent: compactItemCommentaryPrompt(item),
      full,
      treatment,
    });
  });
  if (!dryRun) {
    await db()
      .update(items)
      .set({
        editorNoteZh: zh.editorNoteZh,
        ...("editorAnalysisZh" in zh
          ? { editorAnalysisZh: zh.editorAnalysisZh }
          : {}),
        commentaryAt: new Date(),
      })
      .where(eq(items.id, item.id));
  }
}

async function rewriteClusterCommentary(c: ClusterCandidate, dryRun: boolean) {
  const memberRows = await db()
    .select({
      id: items.id,
      title: items.title,
      bodyMd: items.bodyMd,
      sourceId: items.sourceId,
    })
    .from(items)
    .where(and(eq(items.clusterId, c.id), isNotNull(items.enrichedAt)));
  if (memberRows.length === 0) return;

  const members: EventMember[] = memberRows.map((r) => ({
    sourceId: r.sourceId,
    title: r.title,
  }));
  const richest =
    memberRows.reduce<(typeof memberRows)[number] | null>((best, m) => {
      if (!best) return m;
      return (m.bodyMd ?? "").length > (best.bodyMd ?? "").length ? m : best;
    }, null) ??
    memberRows.find((m) => m.id === c.leadItemId) ??
    memberRows[0];

  const userContent = eventCommentaryUserPrompt({
    canonicalTitleZh: c.canonicalTitleZh,
    canonicalTitleEn: c.canonicalTitleEn,
    memberCount: c.memberCount,
    importance: c.importance,
    members,
    richestBodyMd: (richest.bodyMd ?? "").slice(0, 8000),
    richestSourceId: richest.sourceId,
    richestTitle: richest.title,
  });
  const full = isHighlightItemTier(c.eventTier);
  const treatment = treatmentForScore({
    importance: c.importance,
    tier: c.eventTier,
  });
  const zh = await generateChineseCommentary({
    task: "event-commentary",
    userContent,
    full,
    treatment,
  }).catch((err) => {
    console.warn(
      `[fallback] cluster #${c.id}: compact prompt after provider error (${compactErrorMessage(err)})`,
    );
    return generateChineseCommentary({
      task: "event-commentary",
      userContent: compactClusterCommentaryPrompt({
        cluster: c,
        members,
        richestSourceId: richest.sourceId,
        richestTitle: richest.title,
      }),
      full,
      treatment,
    });
  });
  if (!dryRun) {
    await db()
      .update(clusters)
      .set({
        editorNoteZh: zh.editorNoteZh,
        ...("editorAnalysisZh" in zh
          ? { editorAnalysisZh: zh.editorAnalysisZh }
          : {}),
        commentaryAt: new Date(),
      })
      .where(eq(clusters.id, c.id));
  }
}

async function runGroup<T>(args: {
  name: string;
  rows: T[];
  flags: Flags;
  state: ChineseBackfillState;
  getId: (row: T) => number;
  markDone: (id: number) => void;
  fn: (row: T) => Promise<void>;
}) {
  const { name, rows, flags, getId, markDone, fn, state } = args;
  const selected = maybeLimit(rows, flags.limit);
  console.log(`[${name}] candidates=${rows.length} running=${selected.length}`);
  if (selected.length === 0) return { done: 0, errors: 0 };

  let done = 0;
  let errors = 0;
  let unsaved = 0;
  const limit = pLimit(flags.batchSize);
  await Promise.allSettled(
    selected.map((row, idx) =>
      limit(async () => {
        try {
          await fn(row);
          markDone(getId(row));
          done++;
          unsaved++;
          if (done % 20 === 0 || done === selected.length) {
            console.log(`[${name}] ${done}/${selected.length} last_id=${getId(row)}`);
          }
          if (unsaved >= 20) {
            await saveState(state);
            unsaved = 0;
          }
        } catch (err) {
          errors++;
          console.error(
            `[${name}] error at row ${idx}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }),
    ),
  );
  if (unsaved > 0) await saveState(state);
  return { done, errors };
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const state = await loadState(flags.resume);
  console.log(
    `mode=${flags.dryRun ? "DRY-RUN" : "APPLY"} batch=${flags.batchSize} limit=${flags.limit ?? "ALL"} resume=${flags.resume} targets=${[...flags.targets].join(",")}`,
  );

  const enrichDone = new Set(state.enrichItems);
  const scoreDone = new Set(state.scoreItems);
  const commentaryDone = new Set(state.commentaryItems);
  const clusterDone = new Set(state.clusters);

  const needsItemRows = flags.targets.has("enrich") || flags.targets.has("score");
  const itemRows = needsItemRows ? await loadItemRows() : [];
  const enrichRows = itemRows.filter((item) => !enrichDone.has(item.id));
  const scoreRows = itemRows.filter((item) => !scoreDone.has(item.id));
  const itemCommentaryRows = flags.targets.has("commentary")
    ? (await loadItemCommentaryRows()).filter((item) => !commentaryDone.has(item.id))
    : [];
  const clusterRows = flags.targets.has("clusters")
    ? (await loadClusterCommentaryRows()).filter((cluster) => !clusterDone.has(cluster.id))
    : [];

  if (flags.dryRun) {
    if (flags.targets.has("enrich")) {
      console.log(`[enrich-zh] candidates=${enrichRows.length} running=${maybeLimit(enrichRows, flags.limit).length}`);
    }
    if (flags.targets.has("score")) {
      console.log(`[score-zh] candidates=${scoreRows.length} running=${maybeLimit(scoreRows, flags.limit).length}`);
    }
    if (flags.targets.has("commentary")) {
      console.log(`[commentary-zh] candidates=${itemCommentaryRows.length} running=${maybeLimit(itemCommentaryRows, flags.limit).length}`);
    }
    if (flags.targets.has("clusters")) {
      console.log(`[cluster-commentary-zh] candidates=${clusterRows.length} running=${maybeLimit(clusterRows, flags.limit).length}`);
    }
    console.log("dry-run: no LLM calls and no DB writes. Re-run with --apply to backfill.");
    return;
  }

  let totalDone = 0;
  let totalErrors = 0;

  if (flags.targets.has("enrich")) {
    const r = await runGroup({
      name: "enrich-zh",
      rows: enrichRows,
      flags,
      state,
      getId: (item) => item.id,
      markDone: (id) => state.enrichItems.push(id),
      fn: (item) => rewriteEnrichment(item, flags.dryRun),
    });
    totalDone += r.done;
    totalErrors += r.errors;
  }
  if (flags.targets.has("score")) {
    const r = await runGroup({
      name: "score-zh",
      rows: scoreRows,
      flags,
      state,
      getId: (item) => item.id,
      markDone: (id) => state.scoreItems.push(id),
      fn: (item) => rewriteScore(item, flags.dryRun),
    });
    totalDone += r.done;
    totalErrors += r.errors;
  }
  if (flags.targets.has("commentary")) {
    const r = await runGroup({
      name: "commentary-zh",
      rows: itemCommentaryRows,
      flags,
      state,
      getId: (item) => item.id,
      markDone: (id) => state.commentaryItems.push(id),
      fn: (item) => rewriteItemCommentary(item, flags.dryRun),
    });
    totalDone += r.done;
    totalErrors += r.errors;
  }
  if (flags.targets.has("clusters")) {
    const r = await runGroup({
      name: "cluster-commentary-zh",
      rows: clusterRows,
      flags,
      state,
      getId: (cluster) => cluster.id,
      markDone: (id) => state.clusters.push(id),
      fn: (cluster) => rewriteClusterCommentary(cluster, flags.dryRun),
    });
    totalDone += r.done;
    totalErrors += r.errors;
  }

  await saveState(state);
  console.log(`summary done=${totalDone} errors=${totalErrors}`);
  console.log(`state_file=${STATE_FILE}`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
