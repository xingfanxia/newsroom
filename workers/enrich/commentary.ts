/**
 * Commentary backfill — picks items where tier ∈ (featured, p1, all) AND
 * commentary_at IS NULL, runs the Stage-4 commentary call, persists.
 * Runs after the main enrich batch so transient failures get retried
 * on the next tick instead of leaving holes.
 *
 * Tier gating (2026-05-08): tier='all' takes the note-only path
 * (commentaryNoteSchema, ~200-token output) so the cheap one-liner runs
 * for every non-excluded item. Only featured/p1 pay for the full deep
 * dive. Saves ~85% of output tokens on tier='all' items, which dominate.
 *
 * Stage D skip: items that are members of a multi-source cluster
 * (cluster_id IS NOT NULL AND clusters.member_count >= 2) are excluded from
 * per-item commentary. Those events get event-level commentary from
 * workers/cluster/commentary.ts instead. Singletons (cluster_id IS NULL, or
 * cluster.member_count = 1) continue to receive per-item commentary here as
 * the fallback for single-source events.
 */
import pLimit from "p-limit";
import { and, eq, isNull, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { items, clusters, type Item } from "@/db/schema";
import { generateStructured, profiles } from "@/lib/llm";
import {
  commentarySchema,
  COMMENTARY_SYSTEM,
  commentaryNoteSchema,
  COMMENTARY_NOTE_ONLY_SYSTEM,
  commentaryUserPrompt,
  type CAPABILITIES,
  type TOPICS,
} from "./prompt";
import { generateChineseCommentary } from "./chinese";
import { treatmentForScore } from "./treatment";

type Capability = (typeof CAPABILITIES)[number];
type Topic = (typeof TOPICS)[number];

// Commentary is creative writing, not reasoning — profiles.enrich (standard
// + low reasoning) produces reliable long-form output in one shot. High
// reasoning burned too many reasoning tokens on the new 晚点-style prompt
// and triggered Azure's "No object generated" on ~all items. Low effort is
// also 3-5x faster, letting us fan out wider.
const CONCURRENCY = 30;
const MAX_PER_RUN = 200;

export type CommentaryBackfillReport = {
  candidates: number;
  generated: number;
  errored: number;
  durationMs: number;
  errors: { itemId: number; reason: string }[];
};

export async function runCommentaryBackfill(): Promise<CommentaryBackfillReport> {
  const started = Date.now();
  const client = db();

  // Stage D skip: exclude items that belong to a multi-member cluster —
  // those get event-level commentary from workers/cluster/commentary.ts.
  // A LEFT JOIN on clusters lets us filter in a single query:
  //   - cluster_id IS NULL → singleton item (no cluster yet) → include
  //   - cluster.member_count = 1 → singleton cluster → include
  //   - cluster.member_count >= 2 → multi-source event → exclude (Stage D handles it)
  const pending: Item[] = await client
    .select({ item: items })
    .from(items)
    .leftJoin(clusters, eq(items.clusterId, clusters.id))
    .where(
      and(
        inArray(items.tier, ["featured", "p1", "all"]),
        isNull(items.commentaryAt),
        // Keep singletons and unclustered items; skip multi-member clusters.
        sql`(${items.clusterId} IS NULL OR COALESCE(${clusters.memberCount}, 1) < 2)`,
      ),
    )
    .limit(MAX_PER_RUN)
    .then((rows: Array<{ item: Item }>) => rows.map((r) => r.item));

  if (pending.length === 0) {
    return {
      candidates: 0,
      generated: 0,
      errored: 0,
      durationMs: Date.now() - started,
      errors: [],
    };
  }

  const limit = pLimit(CONCURRENCY);
  const errors: { itemId: number; reason: string }[] = [];
  let generated = 0;

  await Promise.allSettled(
    pending.map((item: Item) =>
      limit(async () => {
        try {
          await generateOneCommentary(item);
          generated++;
        } catch (err) {
          errors.push({
            itemId: item.id,
            reason: err instanceof Error ? err.message : String(err),
          });
        }
      }),
    ),
  );

  return {
    candidates: pending.length,
    generated,
    errored: errors.length,
    durationMs: Date.now() - started,
    errors,
  };
}

// ── Per-item dispatcher ─────────────────────────────────────────────────
// Picks the right schema + system prompt + token budget based on tier.
// featured / p1 → full deep dive. all → note only (much cheaper).

async function generateOneCommentary(item: Item): Promise<void> {
  const tagBag = (item.tags ?? {}) as {
    capabilities?: string[];
    entities?: string[];
    topics?: string[];
  };

  const userContent = commentaryUserPrompt({
    title: item.title,
    body: item.body,
    bodyMd: item.bodyMd,
    summaryZh: item.summaryZh ?? "",
    summaryEn: item.summaryEn ?? "",
    tier: item.tier as "featured" | "p1" | "all",
    importance: item.importance ?? 0,
    tags: {
      capabilities: (tagBag.capabilities ?? []) as Capability[],
      entities: tagBag.entities ?? [],
      topics: (tagBag.topics ?? []) as Topic[],
    },
    url: item.url,
    source: item.sourceId,
    publishedAt: item.publishedAt.toISOString(),
  });

  const isFull = item.tier === "featured" || item.tier === "p1";
  const treatment = treatmentForScore({
    importance: item.importance,
    tier: item.tier,
  });
  const client = db();

  if (isFull) {
    // Full deep dive — note + 300-500 字 analysis in both locales.
    const result = await generateStructured({
      ...profiles.enrich,
      task: "commentary",
      itemId: item.id,
      system: COMMENTARY_SYSTEM,
      messages: [{ role: "user", content: userContent }],
      schema: commentarySchema,
      schemaName: "EditorCommentary",
      // 锐评 target: 200 字 zh + 160 words en + 2 short notes ≈ ~600 output
      // tokens, plus JSON + reasoning. 3072 leaves comfortable headroom
      // without paying for 6144 worth of unused cap on every call.
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
    await client
      .update(items)
      .set({
        editorNoteZh: zh.editorNoteZh,
        editorNoteEn: c.editorNoteEn,
        editorAnalysisZh: "editorAnalysisZh" in zh ? zh.editorAnalysisZh : c.editorAnalysisZh,
        editorAnalysisEn: c.editorAnalysisEn,
        commentaryAt: new Date(),
      })
      // Idempotency guard — only write if still null. Mirrors the cluster
      // path so two overlapping cron ticks can't double-bill an LLM call.
      .where(and(eq(items.id, item.id), isNull(items.commentaryAt)));
  } else {
    // Note-only — tier='all'. Two short strings per locale, ≤ 200 chars each.
    const result = await generateStructured({
      ...(treatment === "fast" ? profiles.fastText : profiles.enrich),
      task: "commentary",
      itemId: item.id,
      system: COMMENTARY_NOTE_ONLY_SYSTEM,
      messages: [{ role: "user", content: userContent }],
      schema: commentaryNoteSchema,
      schemaName: "EditorCommentaryNote",
      // 2 × 200-char fields + JSON + reasoning easily fits in 1024.
      maxTokens: 1024,
    });
    const c = result.data;
    const zh = await generateChineseCommentary({
      task: "commentary",
      itemId: item.id,
      userContent,
      full: false,
      treatment,
    });
    await client
      .update(items)
      .set({
        editorNoteZh: zh.editorNoteZh,
        editorNoteEn: c.editorNoteEn,
        // Intentionally not setting editor_analysis_{zh,en} — preserves any
        // value written by a prior featured/p1 run (or stays null on first
        // commentary). Demotion semantics live elsewhere if/when added.
        commentaryAt: new Date(),
      })
      // Same idempotency guard as the full path.
      .where(and(eq(items.id, item.id), isNull(items.commentaryAt)));
  }
}
