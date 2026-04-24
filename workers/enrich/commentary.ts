/**
 * Commentary backfill — picks items where tier ∈ (featured, p1, all) AND
 * commentary_at IS NULL, runs the Stage-4 commentary call, persists.
 * Runs after the main enrich batch so transient failures get retried
 * on the next tick instead of leaving holes.
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
  commentaryUserPrompt,
  type CommentaryOutput,
  type CAPABILITIES,
  type TOPICS,
} from "./prompt";

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
          const tagBag = (item.tags ?? {}) as {
            capabilities?: string[];
            entities?: string[];
            topics?: string[];
          };
          const result = await generateStructured({
            ...profiles.enrich,
            task: "commentary",
            itemId: item.id,
            system: COMMENTARY_SYSTEM,
            messages: [
              {
                role: "user",
                content: commentaryUserPrompt({
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
                }),
              },
            ],
            schema: commentarySchema,
            schemaName: "EditorCommentary",
            // Strong material targets 800-1400 zh + 600-1100 en + 2 notes.
            // Rough: 1400 zh ≈ 1500 tok, 1100 en ≈ 1400 tok, notes ≈ 200,
            // plus JSON + reasoning overhead. Give headroom so the schema
            // parser doesn't truncate mid-paragraph.
            maxTokens: 6144,
          });
          const c: CommentaryOutput = result.data;
          await client
            .update(items)
            .set({
              editorNoteZh: c.editorNoteZh,
              editorNoteEn: c.editorNoteEn,
              editorAnalysisZh: c.editorAnalysisZh,
              editorAnalysisEn: c.editorAnalysisEn,
              commentaryAt: new Date(),
            })
            .where(eq(items.id, item.id));
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
