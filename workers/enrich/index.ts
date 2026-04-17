import pLimit from "p-limit";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { items } from "@/db/schema";
import type { Item } from "@/db/schema";
import {
  generateStructured,
  embed,
  profiles,
  LLMError,
} from "@/lib/llm";
import {
  enrichSchema,
  scoreSchema,
  commentarySchema,
  ENRICH_SYSTEM,
  COMMENTARY_SYSTEM,
  enrichUserPrompt,
  scoreSystem,
  scoreUserPrompt,
  commentaryUserPrompt,
  type EnrichOutput,
  type ScoreOutput,
  type CommentaryOutput,
} from "./prompt";
import { loadPolicy } from "./policy";

const CONCURRENCY = 4;
const MAX_PER_RUN = 50;

export type EnrichReport = {
  processed: number;
  enriched: number;
  errored: number;
  durationMs: number;
  errors: { itemId: number; stage: string; code: string }[];
};

export async function runEnrichBatch(): Promise<EnrichReport> {
  const started = Date.now();
  const client = db();

  const pending = await client
    .select()
    .from(items)
    .where(isNull(items.enrichedAt))
    .limit(MAX_PER_RUN);

  if (pending.length === 0) {
    return {
      processed: 0,
      enriched: 0,
      errored: 0,
      durationMs: Date.now() - started,
      errors: [],
    };
  }

  const policy = await loadPolicy();
  const limit = pLimit(CONCURRENCY);
  const errors: { itemId: number; stage: string; code: string }[] = [];
  let enriched = 0;

  await Promise.allSettled(
    pending.map((item) =>
      limit(async () => {
        try {
          await enrichOne(item, policy);
          enriched++;
        } catch (err) {
          const code =
            err instanceof LLMError
              ? `llm_${err.provider}`
              : err instanceof Error
                ? "error"
                : "unknown";
          const stage =
            (err as { stage?: string } | undefined)?.stage ?? "unknown";
          errors.push({ itemId: item.id, stage, code });
        }
      }),
    ),
  );

  return {
    processed: pending.length,
    enriched,
    errored: errors.length,
    durationMs: Date.now() - started,
    errors,
  };
}

type PolicyT = Awaited<ReturnType<typeof loadPolicy>>;

class StageError extends Error {
  constructor(public stage: string, message: string) {
    super(message);
    this.name = "StageError";
  }
}

async function enrichOne(item: Item, policy: PolicyT): Promise<void> {
  const client = db();

  // ── Stage 1: summary + tags (low reasoning, fast) ──
  let enriched: EnrichOutput;
  try {
    const result = await generateStructured({
      ...profiles.enrich,
      task: "enrich",
      itemId: item.id,
      system: ENRICH_SYSTEM,
      messages: [
        {
          role: "user",
          content: enrichUserPrompt({
            title: item.title,
            body: item.body,
            url: item.url,
            source: item.sourceId,
          }),
        },
      ],
      schema: enrichSchema,
      schemaName: "Enrichment",
      maxTokens: 1500,
    });
    enriched = result.data;
  } catch (err) {
    throw tag(err, "enrich");
  }

  // ── Stage 2: embedding (Azure text-embedding-3-large) ──
  let embedding: number[];
  try {
    const eText = `${item.title}\n\n${enriched.summaryZh}`;
    const result = await embed({ value: eText, task: "embed", itemId: item.id });
    embedding = result.embedding;
  } catch (err) {
    throw tag(err, "embed");
  }

  // ── Stage 3: score (high reasoning) ──
  let scored: ScoreOutput;
  try {
    const result = await generateStructured({
      ...profiles.score,
      task: "score",
      itemId: item.id,
      system: scoreSystem(policy.content),
      messages: [
        {
          role: "user",
          content: scoreUserPrompt({
            title: item.title,
            summaryZh: enriched.summaryZh,
            tags: enriched.tags,
            url: item.url,
            source: item.sourceId,
            publishedAt: item.publishedAt.toISOString(),
          }),
        },
      ],
      schema: scoreSchema,
      schemaName: "EditorialScore",
      maxTokens: 2048,
    });
    scored = result.data;
  } catch (err) {
    throw tag(err, "score");
  }

  // ── Stage 4: commentary (all non-excluded items — user wants notes on
  //   everything that makes it into the curated feed) ──
  let commentary: CommentaryOutput | null = null;
  if (scored.tier !== "excluded") {
    try {
      const result = await generateStructured({
        ...profiles.score, // standard + high reasoning — upgrade to profiles.agent for pro+xhigh
        task: "commentary",
        itemId: item.id,
        system: COMMENTARY_SYSTEM,
        messages: [
          {
            role: "user",
            content: commentaryUserPrompt({
              title: item.title,
              body: item.body,
              summaryZh: enriched.summaryZh,
              summaryEn: enriched.summaryEn,
              tier: scored.tier,
              importance: scored.importance,
              tags: enriched.tags,
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
      commentary = result.data;
    } catch (err) {
      // Commentary failure is non-fatal — story still gets enriched/scored.
      // Record it as a soft warning but continue to persist.
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[enrich] commentary stage failed for item ${item.id}: ${msg}`,
      );
    }
  }

  // ── Stage 5: persist ──
  await client
    .update(items)
    .set({
      titleZh: enriched.titleZh,
      titleEn: enriched.titleEn,
      summaryZh: enriched.summaryZh,
      summaryEn: enriched.summaryEn,
      tags: enriched.tags,
      importance: scored.importance,
      tier: scored.tier,
      hkr: scored.hkr,
      reasoning: scored.reasoning,
      embedding,
      enrichedAt: new Date(),
      policyVersion: policy.version,
      ...(commentary
        ? {
            editorNoteZh: commentary.editorNoteZh,
            editorNoteEn: commentary.editorNoteEn,
            editorAnalysisZh: commentary.editorAnalysisZh,
            editorAnalysisEn: commentary.editorAnalysisEn,
            commentaryAt: new Date(),
          }
        : {}),
    })
    .where(and(eq(items.id, item.id), isNull(items.enrichedAt)));
}

function tag(err: unknown, stage: string): Error {
  const base = err instanceof Error ? err : new Error(String(err));
  const wrapped = new StageError(stage, base.message);
  (wrapped as Error & { cause?: unknown }).cause = err;
  return wrapped;
}
