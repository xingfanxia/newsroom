#!/usr/bin/env bun
/**
 * Stage-4 commentary backfill — re-runs item-level + cluster-level commentary
 * with the friend-sharing prompts.
 *
 * Lifts the candidate-query patterns from `workers/enrich/commentary.ts` +
 * `workers/cluster/commentary.ts` directly (bypassing their MAX_PER_RUN caps)
 * and layers on cost ceiling, resumable state, and a dry-run forecast.
 *
 * Idempotency: skip rows where commentary_at >= policy_versions.committed_at
 * for the latest 'editorial' skill (fallback 2026-05-08T00:00:00Z). State file
 * + policy-bump guard make partial reruns safe.
 *
 * Usage:
 *   bun scripts/ops/backfill-style.ts --dry-run
 *   bun scripts/ops/backfill-style.ts --batch-size 30 --max-cost-usd 50
 *   bun scripts/ops/backfill-style.ts --resume --tier featured,p1,all
 */
import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import pLimit from "p-limit";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { db, closeDb } from "@/db/client";
import { clusters, items, policyVersions, type Item } from "@/db/schema";
import { generateStructured, profiles } from "@/lib/llm";
import { generateChineseCommentary } from "@/workers/enrich/chinese";
import {
  COMMENTARY_SYSTEM,
  commentarySchema,
  COMMENTARY_NOTE_ONLY_SYSTEM,
  commentaryNoteSchema,
  commentaryUserPrompt,
  type CAPABILITIES,
  type TOPICS,
} from "@/workers/enrich/prompt";
import {
  eventCommentarySchema,
  eventCommentarySystem,
  eventCommentaryNoteSchema,
  eventCommentaryNoteOnlySystem,
  eventCommentaryUserPrompt,
  type EventMember,
} from "@/workers/cluster/prompt";
import { resolvePricing, computeCost } from "@/lib/llm/pricing";
import { treatmentForScore } from "@/workers/enrich/treatment";

type Capability = (typeof CAPABILITIES)[number];
type Topic = (typeof TOPICS)[number];
type Targets = "items" | "clusters" | "both";

// ── Constants ────────────────────────────────────────────────────────
const STATE_FILE = path.resolve(process.cwd(), "scripts/ops/backfill-state.json");
const FALLBACK_POLICY_BUMP = "2026-05-08T00:00:00Z";
const EST_INPUT_TOK = 3000;
// Forecast for the FULL path (锐评): ~200 字 zh + ~160 words en + 2 short
// notes ≈ 700 output tokens. Note-only path is half that. Forecast errs
// high so the operator-facing total is conservative.
const EST_OUTPUT_TOK = 700;
const SECONDS_PER_CALL = 30;
const MODEL_NAME = "DeepSeek-V4-Pro";

// ── CLI ──────────────────────────────────────────────────────────────
interface Flags {
  dryRun: boolean;
  batchSize: number;
  maxCostUsd: number;
  sinceDate: string;
  tiers: string[];
  targets: Targets;
  resume: boolean;
}

function die(msg: string): never {
  console.error(`error: ${msg}\n`);
  printUsage();
  process.exit(2);
}

function printUsage(): void {
  console.log(`backfill-style.ts — re-run Stage-4 commentary with friend-sharing prompts

Flags:
  --dry-run                       print stats + cost forecast, no LLM calls
  --batch-size <N>                concurrency cap (default 30)
  --max-cost-usd <N>              abort when running total >= this (default 50)
  --since-date <YYYY-MM-DD>       items with published_at >= this (default 2026-01-01)
  --tier <featured,p1[,all]>      tiers to backfill (default featured,p1; 'all' = all three)
  --targets <items|clusters|both> which surface to re-enrich (default both)
  --resume                        skip IDs in scripts/ops/backfill-state.json
  --help / -h                     this message`);
}

function parseArgs(argv: string[]): Flags {
  const f: Flags = {
    dryRun: false,
    batchSize: 30,
    maxCostUsd: 50,
    sinceDate: "2026-01-01",
    tiers: ["featured", "p1"],
    targets: "both",
    resume: false,
  };
  const next = (i: number, name: string): string => {
    const v = argv[i];
    if (v === undefined) die(`${name} requires a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      printUsage();
      process.exit(0);
    }
    else if (a === "--dry-run") f.dryRun = true;
    else if (a === "--resume") f.resume = true;
    else if (a === "--batch-size") {
      const n = Number.parseInt(next(++i, a), 10);
      if (!Number.isInteger(n) || n < 1) die(`${a} expects integer >= 1`);
      f.batchSize = n;
    } else if (a === "--max-cost-usd") {
      const n = Number.parseFloat(next(++i, a));
      if (!Number.isFinite(n) || n <= 0) die(`${a} expects positive number`);
      f.maxCostUsd = n;
    } else if (a === "--since-date") {
      const v = next(++i, a);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) die(`${a} must be YYYY-MM-DD, got ${v}`);
      f.sinceDate = v;
    } else if (a === "--tier") {
      const v = next(++i, a);
      f.tiers = v === "all"
        ? ["featured", "p1", "all"]
        : v.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (a === "--targets") {
      const v = next(++i, a);
      if (v !== "items" && v !== "clusters" && v !== "both") {
        die(`--targets must be items|clusters|both, got ${v}`);
      }
      f.targets = v;
    } else die(`unknown flag: ${a}`);
  }
  return f;
}

// ── State + policy bump ──────────────────────────────────────────────
interface BackfillState {
  doneItems: number[];
  doneClusters: number[];
  cumulativeCostUsd: number;
  updatedAt: string;
}

async function loadState(resume: boolean): Promise<BackfillState> {
  const empty: BackfillState = {
    doneItems: [],
    doneClusters: [],
    cumulativeCostUsd: 0,
    updatedAt: new Date().toISOString(),
  };
  if (!resume) return empty;
  try {
    const raw = await readFile(STATE_FILE, "utf8");
    const p = JSON.parse(raw) as Partial<BackfillState>;
    return {
      doneItems: p.doneItems ?? [],
      doneClusters: p.doneClusters ?? [],
      cumulativeCostUsd: p.cumulativeCostUsd ?? 0,
      updatedAt: p.updatedAt ?? empty.updatedAt,
    };
  } catch (err) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT") {
      console.log(`[state] no prior state at ${STATE_FILE}; starting fresh`);
      return empty;
    }
    throw err;
  }
}

async function saveState(s: BackfillState): Promise<void> {
  s.updatedAt = new Date().toISOString();
  await writeFile(STATE_FILE, JSON.stringify(s, null, 2) + "\n", "utf8");
}

async function getPolicyBumpTimestamp(): Promise<Date> {
  const [row] = await db()
    .select({ committedAt: policyVersions.committedAt })
    .from(policyVersions)
    .where(eq(policyVersions.skillName, "editorial"))
    .orderBy(desc(policyVersions.version))
    .limit(1);
  return row?.committedAt ?? new Date(FALLBACK_POLICY_BUMP);
}

// ── Candidate queries ────────────────────────────────────────────────
async function loadItemCandidates(args: {
  tiers: string[];
  sinceDate: string;
  policyBumpAt: Date;
  excludeIds: Set<number>;
}): Promise<Item[]> {
  const since = new Date(`${args.sinceDate}T00:00:00Z`);
  const rows = await db()
    .select({ item: items })
    .from(items)
    .leftJoin(clusters, eq(items.clusterId, clusters.id))
    .where(
      and(
        inArray(items.tier, args.tiers),
        gte(items.publishedAt, since),
        // Mirror workers/enrich/commentary.ts: only singletons / unclustered.
        sql`(${items.clusterId} IS NULL OR COALESCE(${clusters.memberCount}, 1) < 2)`,
        // Idempotency: skip rows already on the new prompt.
        or(isNull(items.commentaryAt), lt(items.commentaryAt, args.policyBumpAt)),
      ),
    )
    .orderBy(desc(items.publishedAt));
  return rows.map((r) => r.item).filter((it) => !args.excludeIds.has(it.id));
}

interface ClusterCandidate {
  id: number;
  leadItemId: number;
  canonicalTitleZh: string | null;
  canonicalTitleEn: string | null;
  memberCount: number;
  importance: number | null;
  latestMemberAt: Date | null;
  eventTier: string | null;
}

async function loadClusterCandidates(args: {
  tiers: string[];
  sinceDate: string;
  policyBumpAt: Date;
  excludeIds: Set<number>;
}): Promise<ClusterCandidate[]> {
  // 2026-05-08: cluster commentary now also covers event_tier='all' (note-only
  // path, see workers/cluster/commentary.ts). Pass through whichever tiers
  // the caller requested; the backfill function dispatches to the right
  // schema per cluster.
  const eventTiers = args.tiers.filter(
    (t) => t === "featured" || t === "p1" || t === "all",
  );
  if (eventTiers.length === 0) return [];
  const since = new Date(`${args.sinceDate}T00:00:00Z`);
  const rows = await db()
    .select({
      id: clusters.id,
      leadItemId: clusters.leadItemId,
      canonicalTitleZh: clusters.canonicalTitleZh,
      canonicalTitleEn: clusters.canonicalTitleEn,
      memberCount: clusters.memberCount,
      importance: clusters.importance,
      latestMemberAt: clusters.latestMemberAt,
      eventTier: clusters.eventTier,
    })
    .from(clusters)
    .where(
      and(
        inArray(clusters.eventTier, eventTiers),
        sql`${clusters.memberCount} >= 2`,
        or(isNull(clusters.commentaryAt), lt(clusters.commentaryAt, args.policyBumpAt)),
        // Cast the ISO string explicitly — drizzle's raw `sql` template doesn't
        // see the column type the way `gte()` does, and postgres-js will refuse
        // to bind a JS Date as a comparison RHS without a type hint.
        sql`COALESCE(${clusters.latestMemberAt}, ${clusters.firstSeenAt}) >= ${since.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(sql`${clusters.importance} DESC NULLS LAST`, desc(clusters.updatedAt));
  return rows.filter((r) => !args.excludeIds.has(r.id));
}

// ── LLM workers (per-item / per-cluster) ─────────────────────────────
type BackfillPath = "full" | "note";
type BackfillResult = {
  path: BackfillPath;
  outputCharsZh: number;
  costUsd: number | null;
};

function compactItemCommentaryPrompt(
  item: Item,
  tags: { capabilities: Capability[]; entities: string[]; topics: Topic[] },
): string {
  const payload = {
    title: item.title,
    source: item.sourceId,
    url: item.url,
    publishedAt: item.publishedAt.toISOString(),
    tier: item.tier,
    importance: item.importance ?? 0,
    summaryZh: item.summaryZh ?? "",
    summaryEn: item.summaryEn ?? "",
    tags,
    bodyOmitted:
      "Compact retry: the original source body was omitted because the provider rejected the long prompt. Use only the title, summaries, source, tags, and score context.",
  };
  return `Backfill note-only editor commentary for one lower-priority feed item.

Use the JSON context below. The body is intentionally omitted, so be explicit if the evidence is thin. Write like a smart friend sharing the link, not like a research memo.

${JSON.stringify(payload, null, 2)}

Follow the requested output schema exactly.`;
}

function compactErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/\s+/g, " ").slice(0, 180);
}

async function backfillItem(item: Item): Promise<BackfillResult> {
  const tagBag = (item.tags ?? {}) as {
    capabilities?: string[];
    entities?: string[];
    topics?: string[];
  };
  const normalizedTags = {
    capabilities: (tagBag.capabilities ?? []) as Capability[],
    entities: tagBag.entities ?? [],
    topics: (tagBag.topics ?? []) as Topic[],
  };
  const userContent = commentaryUserPrompt({
    title: item.title,
    body: item.body,
    bodyMd: item.bodyMd,
    summaryZh: item.summaryZh ?? "",
    summaryEn: item.summaryEn ?? "",
    tier: item.tier as "featured" | "p1" | "all",
    importance: item.importance ?? 0,
    tags: normalizedTags,
    url: item.url,
    source: item.sourceId,
    publishedAt: item.publishedAt.toISOString(),
  });

  const isFull = item.tier === "featured" || item.tier === "p1";
  const treatment = treatmentForScore({
    importance: item.importance,
    tier: item.tier,
  });

  if (isFull) {
    const result = await generateStructured({
      ...profiles.enrich,
      task: "commentary",
      itemId: item.id,
      system: COMMENTARY_SYSTEM,
      messages: [{ role: "user", content: userContent }],
      schema: commentarySchema,
      schemaName: "EditorCommentary",
      maxTokens: 3072,
    });
    const c = result.data;
    const zh = await generateChineseCommentary({
      task: "commentary",
      itemId: item.id,
      userContent,
      full: true,
      treatment: "high",
    });
    await db()
      .update(items)
      .set({
        editorNoteZh: zh.editorNoteZh,
        editorNoteEn: c.editorNoteEn,
        editorAnalysisZh: "editorAnalysisZh" in zh ? zh.editorAnalysisZh : c.editorAnalysisZh,
        editorAnalysisEn: c.editorAnalysisEn,
        commentaryAt: new Date(),
      })
      .where(eq(items.id, item.id));
    const pricing = await resolvePricing(result.model, result.provider);
    const cost = computeCost(
      { inputTokens: result.inputTokens, outputTokens: result.outputTokens },
      pricing,
    );
    return { path: "full", outputCharsZh: c.editorAnalysisZh.length, costUsd: cost };
  } else {
    // tier='all' → note-only path. Don't overwrite any existing analysis.
    const noteProfile = treatment === "fast" ? profiles.fastText : profiles.enrich;
    const generateNote = (content: string, maxTokens = 1024) =>
      generateStructured({
        ...noteProfile,
        task: "commentary",
        itemId: item.id,
        system: COMMENTARY_NOTE_ONLY_SYSTEM,
        messages: [{ role: "user", content }],
        schema: commentaryNoteSchema,
        schemaName: "EditorCommentaryNote",
        maxTokens,
      });

    let noteUserContent = userContent;
    const result = await generateNote(noteUserContent).catch(async (err) => {
      console.warn(
        `[fallback] item #${item.id}: compact note prompt after provider error (${compactErrorMessage(err)})`,
      );
      noteUserContent = compactItemCommentaryPrompt(item, normalizedTags);
      return generateNote(noteUserContent, 768);
    });
    const c = result.data;
    const generateZhNote = (content: string) =>
      generateChineseCommentary({
        task: "commentary",
        itemId: item.id,
        userContent: content,
        full: false,
        treatment,
      });
    const zh = await generateZhNote(noteUserContent).catch(async (err) => {
      console.warn(
        `[fallback] item #${item.id}: compact Chinese note prompt after provider error (${compactErrorMessage(err)})`,
      );
      noteUserContent = compactItemCommentaryPrompt(item, normalizedTags);
      return generateZhNote(noteUserContent);
    });
    await db()
      .update(items)
      .set({
        editorNoteZh: zh.editorNoteZh,
        editorNoteEn: c.editorNoteEn,
        commentaryAt: new Date(),
      })
      .where(eq(items.id, item.id));
    const pricing = await resolvePricing(result.model, result.provider);
    const cost = computeCost(
      { inputTokens: result.inputTokens, outputTokens: result.outputTokens },
      pricing,
    );
    // Note length is the only output signal here — analysis was never produced.
    return { path: "note", outputCharsZh: c.editorNoteZh.length, costUsd: cost };
  }
}

async function backfillCluster(c: ClusterCandidate): Promise<BackfillResult | null> {
  const memberRows = await db()
    .select({
      id: items.id,
      title: items.title,
      bodyMd: items.bodyMd,
      sourceId: items.sourceId,
    })
    .from(items)
    .where(and(eq(items.clusterId, c.id), isNotNull(items.enrichedAt)));
  if (memberRows.length === 0) return null;

  const members: EventMember[] = memberRows.map((r) => ({ sourceId: r.sourceId, title: r.title }));
  const richest =
    memberRows.reduce<(typeof memberRows)[number] | null>((best, m) => {
      if (!best) return m;
      return (m.bodyMd ?? "").length > (best.bodyMd ?? "").length ? m : best;
    }, null) ??
    memberRows.find((m) => m.id === c.leadItemId) ??
    memberRows[0];
  const truncatedBody = (richest.bodyMd ?? "").slice(0, 8000);

  const userContent = eventCommentaryUserPrompt({
    canonicalTitleZh: c.canonicalTitleZh,
    canonicalTitleEn: c.canonicalTitleEn,
    memberCount: c.memberCount,
    importance: c.importance,
    members,
    richestBodyMd: truncatedBody,
    richestSourceId: richest.sourceId,
    richestTitle: richest.title,
  });

  const isFull = c.eventTier === "featured" || c.eventTier === "p1";
  const treatment = treatmentForScore({
    importance: c.importance,
    tier: c.eventTier,
  });

  if (isFull) {
    const result = await generateStructured({
      ...profiles.enrich,
      task: "event-commentary",
      system: eventCommentarySystem,
      messages: [{ role: "user", content: userContent }],
      schema: eventCommentarySchema,
      schemaName: "EventEditorCommentary",
      maxTokens: 3072,
    });
    const out = result.data;
    const zh = await generateChineseCommentary({
      task: "event-commentary",
      userContent,
      full: true,
      treatment: "high",
    });
    await db()
      .update(clusters)
      .set({
        editorNoteZh: zh.editorNoteZh,
        editorNoteEn: out.editorNoteEn,
        editorAnalysisZh: "editorAnalysisZh" in zh ? zh.editorAnalysisZh : out.editorAnalysisZh,
        editorAnalysisEn: out.editorAnalysisEn,
        commentaryAt: new Date(),
      })
      .where(eq(clusters.id, c.id));
    const pricing = await resolvePricing(result.model, result.provider);
    const cost = computeCost(
      { inputTokens: result.inputTokens, outputTokens: result.outputTokens },
      pricing,
    );
    return { path: "full", outputCharsZh: out.editorAnalysisZh.length, costUsd: cost };
  } else {
    // event_tier='all' → note-only.
    const result = await generateStructured({
      ...(treatment === "fast" ? profiles.fastText : profiles.enrich),
      task: "event-commentary",
      system: eventCommentaryNoteOnlySystem,
      messages: [{ role: "user", content: userContent }],
      schema: eventCommentaryNoteSchema,
      schemaName: "EventEditorCommentaryNote",
      maxTokens: 1024,
    });
    const out = result.data;
    const zh = await generateChineseCommentary({
      task: "event-commentary",
      userContent,
      full: false,
      treatment,
    });
    await db()
      .update(clusters)
      .set({
        editorNoteZh: zh.editorNoteZh,
        editorNoteEn: out.editorNoteEn,
        commentaryAt: new Date(),
      })
      .where(eq(clusters.id, c.id));
    const pricing = await resolvePricing(result.model, result.provider);
    const cost = computeCost(
      { inputTokens: result.inputTokens, outputTokens: result.outputTokens },
      pricing,
    );
    return { path: "note", outputCharsZh: out.editorNoteZh.length, costUsd: cost };
  }
}

// ── Main ─────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));
  const policyBumpAt = await getPolicyBumpTimestamp();
  const state = await loadState(flags.resume);

  console.log(`policy bump @ ${policyBumpAt.toISOString()} (skill=editorial latest version)`);
  console.log(
    `tiers=${flags.tiers.join(",")} since=${flags.sinceDate} targets=${flags.targets} batch=${flags.batchSize} cap=$${flags.maxCostUsd}`,
  );
  if (flags.resume) {
    console.log(
      `[resume] done_items=${state.doneItems.length} done_clusters=${state.doneClusters.length} cumulative_cost=$${state.cumulativeCostUsd.toFixed(4)}`,
    );
  }

  const excludeItems = new Set(flags.resume ? state.doneItems : []);
  const excludeClusters = new Set(flags.resume ? state.doneClusters : []);

  const itemCandidates =
    flags.targets === "clusters"
      ? []
      : await loadItemCandidates({ tiers: flags.tiers, sinceDate: flags.sinceDate, policyBumpAt, excludeIds: excludeItems });
  const clusterCandidates =
    flags.targets === "items"
      ? []
      : await loadClusterCandidates({ tiers: flags.tiers, sinceDate: flags.sinceDate, policyBumpAt, excludeIds: excludeClusters });

  // Forecast.
  const pricing = await resolvePricing(MODEL_NAME, "azure-deepseek");
  const perCallCost = pricing
    ? computeCost({ inputTokens: EST_INPUT_TOK, outputTokens: EST_OUTPUT_TOK }, pricing)
    : null;
  const totalCalls = itemCandidates.length + clusterCandidates.length;
  const totalForecast = perCallCost !== null ? Number((perCallCost * totalCalls).toFixed(4)) : null;
  const wallSec = (totalCalls * SECONDS_PER_CALL) / Math.max(1, flags.batchSize);

  console.log(`\n── Forecast ──`);
  console.log(`  items:    ${itemCandidates.length} candidate(s)`);
  console.log(`  clusters: ${clusterCandidates.length} candidate(s) (multi-member, member_count >= 2)`);
  console.log(`  per-call: ~${EST_INPUT_TOK} in / ${EST_OUTPUT_TOK} out tokens`);
  console.log(
    `  pricing:  ${pricing ? `model=${MODEL_NAME} input=$${pricing.inputCostPerToken}/tok output=$${pricing.outputCostPerToken}/tok` : `pricing unknown for ${MODEL_NAME}`}`,
  );
  console.log(`  per-call cost: ${perCallCost !== null ? "$" + perCallCost.toFixed(6) : "(unknown)"}`);
  console.log(
    `  total est:     ${totalForecast !== null ? "$" + totalForecast.toFixed(2) : "(unknown)"} for ${totalCalls} call(s)`,
  );
  console.log(`  wall (est):    ~${(wallSec / 60).toFixed(1)}m at batch-size ${flags.batchSize}`);

  if (flags.dryRun) {
    console.log(`\n[dry-run] no LLM calls made — exit 0`);
    await closeDb();
    return;
  }

  if (totalForecast !== null && state.cumulativeCostUsd + totalForecast > flags.maxCostUsd) {
    console.warn(
      `[warn] forecast ($${(state.cumulativeCostUsd + totalForecast).toFixed(2)}) exceeds --max-cost-usd ($${flags.maxCostUsd}); will abort cleanly when ceiling hits.`,
    );
  }

  // ── Live run ────────────────────────────────────────────────────
  const limit = pLimit(flags.batchSize);
  let cumulativeCost = state.cumulativeCostUsd;
  let itemsDone = 0;
  let clustersDone = 0;
  let fullPathRuns = 0;
  let notePathRuns = 0;
  let errors = 0;
  let aborted = false;
  let pendingSaves = 0;
  const persistEvery = 20;
  const printEvery = 5;

  const persist = async () => {
    state.cumulativeCostUsd = cumulativeCost;
    await saveState(state);
  };

  const onComplete = async (label: string, id: number, desc: string) => {
    pendingSaves++;
    if ((itemsDone + clustersDone) % printEvery === 0) {
      console.log(
        `[${itemsDone + clustersDone}/${totalCalls}] ${label} #${id} ${desc} — running cost $${cumulativeCost.toFixed(4)}`,
      );
    }
    if (pendingSaves >= persistEvery) {
      await persist();
      pendingSaves = 0;
    }
  };

  const ceilingHit = (): boolean => {
    const projected = cumulativeCost + (perCallCost ?? 0);
    return projected > flags.maxCostUsd;
  };

  const tryAbort = (): boolean => {
    if (ceilingHit()) {
      if (!aborted) {
        console.warn(
          `[abort] cost ceiling hit at $${cumulativeCost.toFixed(4)} (cap $${flags.maxCostUsd}); finishing in-flight calls.`,
        );
      }
      aborted = true;
      return true;
    }
    return false;
  };

  if (itemCandidates.length > 0) {
    console.log(`\n── Backfilling ${itemCandidates.length} item(s) ──`);
    await Promise.allSettled(
      itemCandidates.map((item) =>
        limit(async () => {
          if (aborted || tryAbort()) return;
          try {
            const r = await backfillItem(item);
            cumulativeCost += r.costUsd ?? perCallCost ?? 0;
            itemsDone++;
            if (r.path === "full") fullPathRuns++;
            else notePathRuns++;
            state.doneItems.push(item.id);
            const pathLabel = r.path === "full" ? "deep dive" : "note only";
            await onComplete(
              "item",
              item.id,
              `'${item.title.slice(0, 50)}' — generated ${r.outputCharsZh} 字 (zh, ${pathLabel})`,
            );
          } catch (err) {
            errors++;
            console.error(`[err] item #${item.id}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }),
      ),
    );
  }

  if (clusterCandidates.length > 0 && !aborted) {
    console.log(`\n── Backfilling ${clusterCandidates.length} cluster(s) ──`);
    await Promise.allSettled(
      clusterCandidates.map((c) =>
        limit(async () => {
          if (aborted || tryAbort()) return;
          try {
            const r = await backfillCluster(c);
            if (!r) return;
            cumulativeCost += r.costUsd ?? perCallCost ?? 0;
            clustersDone++;
            if (r.path === "full") fullPathRuns++;
            else notePathRuns++;
            state.doneClusters.push(c.id);
            await onComplete(
              "cluster",
              c.id,
              `members=${c.memberCount} — generated ${r.outputCharsZh} 字 (zh, ${r.path === "full" ? "deep dive" : "note only"})`,
            );
          } catch (err) {
            errors++;
            console.error(`[err] cluster #${c.id}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }),
      ),
    );
  }

  await persist();

  console.log(`\n── Summary ──`);
  console.log(`  items_done:      ${itemsDone}`);
  console.log(`  clusters_done:   ${clustersDone}`);
  console.log(`  full deep dives: ${fullPathRuns}  (featured / p1 — note + analysis)`);
  console.log(`  note-only runs:  ${notePathRuns}  (tier 'all' — note alone)`);
  console.log(`  total_cost_usd:  $${cumulativeCost.toFixed(4)}`);
  console.log(`  errors:          ${errors}`);
  console.log(`  state_file:      ${STATE_FILE}`);
  if (aborted) console.log(`  aborted: cost ceiling reached`);

  await closeDb();
}

main().catch(async (err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("backfill-style failed:", msg);
  await closeDb().catch(() => {});
  process.exit(1);
});
