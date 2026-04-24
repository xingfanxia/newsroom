/**
 * Event-level commentary worker (Stage D).
 *
 * Generates editorial commentary for multi-member clusters where
 * member_count >= 2 and event_tier IN ('featured', 'p1').
 *
 * Singletons (member_count = 1 or cluster_id IS NULL) continue to receive
 * per-item commentary from workers/enrich/commentary.ts — this worker is
 * intentionally exclusive to multi-source events.
 *
 * Candidate order: importance DESC NULLS LAST, updated_at DESC.
 * Cap: MAX_EVENT_COMMENTARY_PER_RUN per cron tick — commentary is the most
 * expensive LLM call in the pipeline (6144 max tokens, long-form prose).
 */
import { and, desc, eq, inArray, isNull, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clusters, items } from "@/db/schema";
import { generateStructured, profiles } from "@/lib/llm";
import {
  eventCommentarySchema,
  eventCommentarySystem,
  eventCommentaryUserPrompt,
  type EventCommentaryOutput,
  type EventMember,
} from "./prompt";

export const MAX_EVENT_COMMENTARY_PER_RUN = 8;

export type EventCommentaryReport = {
  processed: number;
  generated: number;
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
export async function runEventCommentaryBatch(): Promise<EventCommentaryReport> {
  const started = Date.now();
  const client = db();

  // ── Candidate query ──────────────────────────────────────────────────────
  const candidates = await client
    .select({
      id: clusters.id,
      leadItemId: clusters.leadItemId,
      canonicalTitleZh: clusters.canonicalTitleZh,
      canonicalTitleEn: clusters.canonicalTitleEn,
      memberCount: clusters.memberCount,
      importance: clusters.importance,
    })
    .from(clusters)
    .where(
      and(
        inArray(clusters.eventTier, ["featured", "p1"]),
        sql`${clusters.memberCount} >= 2`,
        isNull(clusters.commentaryAt),
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
    durationMs: Date.now() - started,
    errors,
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────

interface ClusterCandidate {
  id: number;
  leadItemId: number;
  canonicalTitleZh: string | null;
  canonicalTitleEn: string | null;
  memberCount: number;
  importance: number | null;
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

  const result = await generateStructured({
    ...profiles.enrich,
    task: "event-commentary",
    system: eventCommentarySystem,
    messages: [{ role: "user", content: userPrompt }],
    schema: eventCommentarySchema,
    schemaName: "EventEditorCommentary",
    // Same budget as per-item commentary — long-form prose in both zh + en.
    maxTokens: 6144,
  });

  const c: EventCommentaryOutput = result.data;

  // Persist to clusters row
  await client
    .update(clusters)
    .set({
      editorNoteZh: c.editorNoteZh,
      editorNoteEn: c.editorNoteEn,
      editorAnalysisZh: c.editorAnalysisZh,
      editorAnalysisEn: c.editorAnalysisEn,
      commentaryAt: new Date(),
    })
    .where(
      and(
        eq(clusters.id, candidate.id),
        // Idempotency guard: only write if still null — concurrent runs
        // can't double-write.
        isNull(clusters.commentaryAt),
      ),
    );
}
