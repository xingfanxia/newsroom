/**
 * Event-level commentary worker (Stage D).
 *
 * Generates editorial commentary for multi-member clusters where
 * member_count >= 2 and event_tier IN ('featured', 'p1', 'all').
 *
 * Tier gating (2026-05-08): event_tier='all' takes the note-only path
 * (eventCommentaryNoteSchema, ~200-token output) — the cheap one-liner
 * runs for every non-excluded multi-source event. Featured/p1 still pay
 * for the full deep dive. Mirrors workers/enrich/commentary.ts.
 *
 * Singletons (member_count = 1 or cluster_id IS NULL) continue to receive
 * per-item commentary from workers/enrich/commentary.ts — this worker is
 * intentionally exclusive to multi-source events.
 *
 * Candidate order: importance DESC NULLS LAST, updated_at DESC.
 * Cap: MAX_EVENT_COMMENTARY_PER_RUN per cron tick — note-only path is
 * cheap, but we keep the same cap so a featured-heavy hour doesn't blow
 * the per-tick budget.
 */
import {
  and,
  desc,
  eq,
  inArray,
  isNull,
  isNotNull,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "@/db/client";
import { clusters, items } from "@/db/schema";
import { generateStructured, profiles } from "@/lib/llm";
import { isHighlightItemTier, VISIBLE_ITEM_TIERS } from "@/lib/types";
import {
  eventCommentarySchema,
  eventCommentarySystem,
  eventCommentaryNoteSchema,
  eventCommentaryNoteOnlySystem,
  eventCommentaryUserPrompt,
  type EventMember,
} from "./prompt";
import { generateChineseCommentary } from "@/workers/enrich/chinese";
import { treatmentForScore } from "@/workers/enrich/treatment";

const MAX_EVENT_COMMENTARY_PER_RUN = 8;

type EventCommentaryBatchOptions = {
  /**
   * Restrict candidate events to recent latest_member_at / first_seen_at.
   * Null means no recency filter and is intended for explicit operator
   * backfills, not scheduled cron.
   */
  recencyHours?: number | null;
};

export type EventCommentaryReport = {
  processed: number;
  generated: number;
  recencyHours: number | null;
  durationMs: number;
  errors: Array<{ clusterId: number; reason: string }>;
};

/**
 * Run one batch of event-level commentary generation.
 *
 * Picks up to MAX_EVENT_COMMENTARY_PER_RUN clusters that:
 *   - event_tier IN ('featured', 'p1')
 *   - member_count >= 2
 *   - commentary_at IS NULL
 *
 * For each cluster:
 *   1. Loads all member items (title + source_id + body_md).
 *   2. Picks the "richest" member (longest body_md, falling back to lead).
 *   3. Truncates richest body_md to 8000 chars.
 *   4. Builds event-level prompt and calls LLM (profiles.enrich — same as
 *      per-item commentary: low reasoning, reliable long-form prose).
 *   5. Writes editor_note_{zh,en}, editor_analysis_{zh,en},
 *      commentary_at = NOW() to the clusters row.
 *
 * Runs sequentially (no concurrency) — cap is already low and LLM calls
 * are long-running; parallel runs at this scale just hit Azure's
 * reasoning-effort throttle faster.
 */
export async function runEventCommentaryBatch(
  opts: EventCommentaryBatchOptions = {},
): Promise<EventCommentaryReport> {
  const started = Date.now();
  const client = db();

  // ── Candidate query ──────────────────────────────────────────────────────
  // Picks featured/p1/all multi-member events. Tier dispatched inside
  // processOneCluster — featured/p1 → full schema; all → note-only.
  const candidates = await client
    .select({
      id: clusters.id,
      leadItemId: clusters.leadItemId,
      canonicalTitleZh: clusters.canonicalTitleZh,
      canonicalTitleEn: clusters.canonicalTitleEn,
      memberCount: clusters.memberCount,
      importance: clusters.importance,
      eventTier: clusters.eventTier,
      commentaryAt: clusters.commentaryAt,
    })
    .from(clusters)
    .where(
      and(
        inArray(clusters.eventTier, VISIBLE_ITEM_TIERS),
        sql`${clusters.memberCount} >= 2`,
        commentaryRegenClause(),
        commentaryRecencyFilter(opts),
      ),
    )
    .orderBy(
      sql`${clusters.importance} DESC NULLS LAST`,
      desc(clusters.updatedAt),
    )
    .limit(MAX_EVENT_COMMENTARY_PER_RUN);

  const errors: Array<{ clusterId: number; reason: string }> = [];
  let generated = 0;

  for (const candidate of candidates) {
    try {
      await processOneCluster(candidate);
      generated++;
    } catch (err) {
      errors.push({
        clusterId: candidate.id,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    processed: candidates.length,
    generated,
    recencyHours: opts.recencyHours ?? null,
    durationMs: Date.now() - started,
    errors,
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────

/**
 * W6b — the "regenerate stale commentary, not just fill the initial null"
 * predicate. A cluster is (re)commented when:
 *   (a) it was never commented (commentary_at IS NULL), OR
 *   (b) it grew to ≥2× the member_count recorded at last commentary — the
 *       early 2-source note is stale once the event reaches ~10 sources, OR
 *   (c) it crossed into featured/p1 but the full analysis was never written
 *       (it was commented note-only at a lower tier).
 *
 * Loop-safe by construction: (b) re-stamps commentary_member_count on every
 * regen, so it can't fire again until the count doubles ANEW; (c) writes
 * editor_analysis_zh, so that arm goes false after one full pass. A NULL
 * commentary_member_count (pre-column rows) makes (b) evaluate NULL/false —
 * those clusters regen only via (c) and never thrash.
 *
 * Exported so the trigger is unit-testable against real SQLite without paying
 * for the LLM path the batch runner wraps it in.
 */
export function commentaryRegenClause(): SQL {
  return sql`(
    ${clusters.commentaryAt} IS NULL
    OR ${clusters.memberCount} >= 2 * ${clusters.commentaryMemberCount}
    OR (
      ${clusters.eventTier} IN ('featured', 'p1')
      AND ${clusters.editorAnalysisZh} IS NULL
    )
  )`;
}

function commentaryRecencyFilter(opts: EventCommentaryBatchOptions) {
  if (opts.recencyHours == null) return sql`true`;
  // ms-epoch INTEGER columns: compare against Date.now() minus the window in ms
  // (was now() - make_interval(hours => N) under Postgres).
  return sql`COALESCE(${clusters.latestMemberAt}, ${clusters.firstSeenAt}) >= ${Date.now()} - ${opts.recencyHours * 3_600_000}`;
}

interface ClusterCandidate {
  id: number;
  leadItemId: number;
  canonicalTitleZh: string | null;
  canonicalTitleEn: string | null;
  memberCount: number;
  importance: number | null;
  eventTier: string | null;
  commentaryAt: Date | null;
}

type MemberRow = {
  id: number;
  title: string;
  bodyMd: string | null;
  sourceId: string;
};

async function processOneCluster(candidate: ClusterCandidate): Promise<void> {
  const client = db();

  // Load all member items for this cluster
  const memberRows: MemberRow[] = await client
    .select({
      id: items.id,
      title: items.title,
      bodyMd: items.bodyMd,
      sourceId: items.sourceId,
    })
    .from(items)
    .where(
      and(
        eq(items.clusterId, candidate.id),
        isNotNull(items.enrichedAt),
      ),
    );

  if (memberRows.length === 0) {
    // Cluster has no enriched members yet — skip silently, will retry next tick
    return;
  }

  // Build member list for the prompt
  const members: EventMember[] = memberRows.map((r) => ({
    sourceId: r.sourceId,
    title: r.title,
  }));

  // Pick the "richest" member — longest body_md. Fall back to lead item.
  const richest: MemberRow =
    memberRows.reduce<MemberRow | null>((best, m) => {
      if (!best) return m;
      const mLen = (m.bodyMd ?? "").length;
      const bestLen = (best.bodyMd ?? "").length;
      return mLen > bestLen ? m : best;
    }, null) ??
    memberRows.find((m) => m.id === candidate.leadItemId) ??
    memberRows[0];

  const truncatedBody = (richest.bodyMd ?? "").slice(0, 8000);

  // Build prompt and call LLM
  const userPrompt = eventCommentaryUserPrompt({
    canonicalTitleZh: candidate.canonicalTitleZh,
    canonicalTitleEn: candidate.canonicalTitleEn,
    memberCount: candidate.memberCount,
    importance: candidate.importance,
    members,
    richestBodyMd: truncatedBody,
    richestSourceId: richest.sourceId,
    richestTitle: richest.title,
  });

  const isFull = isHighlightItemTier(candidate.eventTier);
  const treatment = treatmentForScore({
    importance: candidate.importance,
    tier: candidate.eventTier,
  });

  // Optimistic write guard (W6b). The old guard was `commentary_at IS NULL`
  // (write once, never again) — that blocked regen. Guard on the commentary_at
  // we LOADED instead: a concurrent run that already regenerated moves the
  // value, so our stale write no-ops; a fresh regen still lands.
  const commentaryUnchanged =
    candidate.commentaryAt == null
      ? isNull(clusters.commentaryAt)
      : eq(clusters.commentaryAt, candidate.commentaryAt);

  if (isFull) {
    // Full deep dive — note + analysis, both locales.
    const result = await generateStructured({
      ...profiles.enrich,
      task: "event-commentary",
      system: eventCommentarySystem,
      messages: [{ role: "user", content: userPrompt }],
      schema: eventCommentarySchema,
      schemaName: "EventEditorCommentary",
      // 锐评 target: 200 字 zh + 160 words en + 2 short notes. 3072 fits
      // comfortably with reasoning + JSON overhead.
      maxTokens: 3072,
    });
    const c = result.data;
    const zh = await generateChineseCommentary({
      task: "event-commentary",
      userContent: userPrompt,
      full: true,
      treatment: "high",
    });
    await client
      .update(clusters)
      .set({
        editorNoteZh: zh.editorNoteZh,
        editorNoteEn: c.editorNoteEn,
        editorAnalysisZh: "editorAnalysisZh" in zh ? zh.editorAnalysisZh : c.editorAnalysisZh,
        editorAnalysisEn: c.editorAnalysisEn,
        commentaryAt: new Date(),
        // Stamp the member_count at commentary time so the W6b growth-regen
        // trigger measures from here, not from the last +1.
        commentaryMemberCount: candidate.memberCount,
      })
      .where(and(eq(clusters.id, candidate.id), commentaryUnchanged));
  } else {
    // Note-only — event_tier='all'.
    const result = await generateStructured({
      ...(treatment === "fast" ? profiles.fastText : profiles.enrich),
      task: "event-commentary",
      system: eventCommentaryNoteOnlySystem,
      messages: [{ role: "user", content: userPrompt }],
      schema: eventCommentaryNoteSchema,
      schemaName: "EventEditorCommentaryNote",
      maxTokens: 1024,
    });
    const c = result.data;
    const zh = await generateChineseCommentary({
      task: "event-commentary",
      userContent: userPrompt,
      full: false,
      treatment,
    });
    await client
      .update(clusters)
      .set({
        editorNoteZh: zh.editorNoteZh,
        editorNoteEn: c.editorNoteEn,
        // Intentionally not setting editor_analysis_{zh,en} — preserves any
        // value written by a prior featured/p1 run (or stays null on first
        // commentary). Demotion semantics live elsewhere if/when added.
        commentaryAt: new Date(),
        commentaryMemberCount: candidate.memberCount,
      })
      .where(and(eq(clusters.id, candidate.id), commentaryUnchanged));
  }
}
