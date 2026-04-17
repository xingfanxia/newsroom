/**
 * Commentary backfill — picks items where tier ∈ (featured, p1) AND
 * commentary_at IS NULL, runs the Stage-4 commentary call, persists.
 * Runs after the main enrich batch so transient failures get retried
 * on the next tick instead of leaving holes.
 */
import pLimit from "p-limit";
import { and, eq, isNull, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { items } from "@/db/schema";
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

const CONCURRENCY = 6;
const MAX_PER_RUN = 60;

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

  const pending = await client
    .select()
    .from(items)
    .where(
      and(
        inArray(items.tier, ["featured", "p1", "all"]),
        isNull(items.commentaryAt),
      ),
    )
    .limit(MAX_PER_RUN);

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
    pending.map((item) =>
      limit(async () => {
        try {
          const tagBag = (item.tags ?? {}) as {
            capabilities?: string[];
            entities?: string[];
            topics?: string[];
          };
          const result = await generateStructured({
            ...profiles.score,
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
            maxTokens: 3072,
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
