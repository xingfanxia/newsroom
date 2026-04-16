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
  ENRICH_SYSTEM,
  enrichUserPrompt,
  scoreSystem,
  scoreUserPrompt,
  type EnrichOutput,
  type ScoreOutput,
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
    const result = await embed({ value: eText });
    embedding = result.embedding;
  } catch (err) {
    throw tag(err, "embed");
  }

  // ── Stage 3: score (high reasoning) ──
  let scored: ScoreOutput;
  try {
    const result = await generateStructured({
      ...profiles.score,
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

  // ── Stage 4: persist ──
  await client
    .update(items)
    .set({
      summaryZh: enriched.summaryZh,
      summaryEn: enriched.summaryEn,
      tags: enriched.tags,
      importance: scored.importance,
      tier: scored.tier,
      reasoning: scored.reasoning,
      embedding,
      enrichedAt: new Date(),
      policyVersion: policy.version,
    })
    .where(and(eq(items.id, item.id), isNull(items.enrichedAt)));
}

function tag(err: unknown, stage: string): Error {
  const base = err instanceof Error ? err : new Error(String(err));
  const wrapped = new StageError(stage, base.message);
  (wrapped as Error & { cause?: unknown }).cause = err;
  return wrapped;
}
