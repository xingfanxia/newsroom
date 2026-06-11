import pLimit from "p-limit";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { items, sources } from "@/db/schema";
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
import {
  generateChineseEnrichment,
  generateChineseScoreRationale,
} from "./chinese";
import { loadPolicy } from "./policy";
import { treatmentForScore, type EnrichTreatment } from "./treatment";

// Enrich does stages 1-3 (summary + tags → embed → score). Commentary used
// to be stage 4 here but was failing silently with Azure's "No object
// generated" on the long-form prompt, AND blocking enrich's throughput
// because each worker waited on a 20-40s commentary call. It's now a
// separate worker (workers/enrich/commentary.ts) that runs in parallel
// at its own concurrency, and retries independently.
// Azure standard tier is at 10M TPM / 100K RPM — well above anything we
// generate. Bottleneck is per-item wall-clock (score stage is ~30s w/ high
// reasoning); fan out widely so one cron tick drains the backlog instead
// of dripping 4 items at a time.
const CONCURRENCY = 40;
const MAX_PER_RUN = 200;

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

  // Priority order:
  //   1. items that were previously tiered non-excluded (featured/p1/all)
  //      and are now unenriched — these are the curated cards readers see
  //      AND we usually reset them deliberately to re-run with new prompts.
  //   2. items that have bodyMd (Jina already fetched) — they'll benefit
  //      from a richer enrichment than a title-only item.
  //   3. most-recent-first by publishedAt.
  const pending = await client
    .select()
    .from(items)
    .where(isNull(items.enrichedAt))
    .orderBy(
      sql`CASE
        WHEN ${items.tier} IN ('featured','p1','all') THEN 0
        WHEN ${items.bodyMd} IS NOT NULL THEN 1
        WHEN ${items.tier} = 'excluded' THEN 3
        ELSE 2
      END`,
      desc(items.publishedAt),
    )
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

  // Source-level allow-list: sources flagged never_exclude get a tier floor
  // of "all". Load once and pass through instead of querying per item.
  const neverExcludeRows = await client
    .select({ id: sources.id })
    .from(sources)
    .where(eq(sources.neverExclude, true));
  const neverExcludeSet = new Set(neverExcludeRows.map((r) => r.id));

  const limit = pLimit(CONCURRENCY);
  const errors: { itemId: number; stage: string; code: string }[] = [];
  let enriched = 0;

  await Promise.allSettled(
    pending.map((item) =>
      limit(async () => {
        try {
          await enrichOne(item, policy, neverExcludeSet);
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

async function enrichOne(
  item: Item,
  policy: PolicyT,
  neverExcludeSet: Set<string>,
): Promise<void> {
  const client = db();

  let enriched = await generateEnrichment(item, "fast");
  let embedding = await generateEmbedding(item, enriched);
  let scored = await generateScore(item, enriched, policy, "fast");

  // Operator-flagged sources (sources.never_exclude) keep tier floored at
  // "all" regardless of scorer verdict. YouTube channels and community
  // digests (ai-chatgroup-daily) are the primary cases: interesting by
  // virtue of being hand-added to the allow-list. Low importance still
  // sorts them below curated AI content — they just stay browseable.
  const finalTier =
    neverExcludeSet.has(item.sourceId) && scored.tier === "excluded"
      ? "all"
      : scored.tier;

  let effectiveTier = finalTier;
  if (treatmentForScore({ importance: scored.importance, tier: finalTier }) === "high") {
    const upgraded = await regenerateHighValueItem(item, policy, neverExcludeSet);
    enriched = upgraded.enriched;
    embedding = upgraded.embedding;
    scored = upgraded.scored;
    effectiveTier = upgraded.finalTier;
  }

  // ── Stage 4: persist (commentary runs in a separate worker) ──
  await client
    .update(items)
    .set({
      titleZh: enriched.titleZh,
      titleEn: enriched.titleEn,
      summaryZh: enriched.summaryZh,
      summaryEn: enriched.summaryEn,
      tags: enriched.tags,
      importance: scored.importance,
      tier: effectiveTier,
      hkr: scored.hkr,
      reasoningZh: scored.reasoningZh,
      reasoningEn: scored.reasoningEn,
      embedding,
      enrichedAt: new Date(),
      policyVersion: policy.version,
    })
    .where(and(eq(items.id, item.id), isNull(items.enrichedAt)));
}

async function generateEnrichment(
  item: Item,
  treatment: EnrichTreatment,
): Promise<EnrichOutput> {
  try {
    const result = await generateStructured({
      ...(treatment === "fast" ? profiles.fastText : profiles.enrich),
      task: "enrich",
      itemId: item.id,
      system: ENRICH_SYSTEM,
      messages: [
        {
          role: "user",
          content: enrichUserPrompt({
            title: item.title,
            body: item.body,
            bodyMd: item.bodyMd,
            url: item.url,
            source: item.sourceId,
          }),
        },
      ],
      schema: enrichSchema,
      schemaName: "Enrichment",
      maxTokens: 1500,
    });
    const enriched = result.data;
    const zh = await generateChineseEnrichment({
      title: item.title,
      body: item.body,
      bodyMd: item.bodyMd,
      url: item.url,
      source: item.sourceId,
      titleEn: enriched.titleEn,
      summaryEn: enriched.summaryEn,
      itemId: item.id,
      treatment,
    });
    return {
      ...enriched,
      titleZh: zh.titleZh,
      summaryZh: zh.summaryZh,
    };
  } catch (err) {
    throw tag(err, "enrich");
  }
}

async function generateEmbedding(
  item: Item,
  enriched: EnrichOutput,
): Promise<number[]> {
  try {
    const eText = `${item.title}\n\n${enriched.summaryZh}`;
    const result = await embed({ value: eText, task: "embed", itemId: item.id });
    return result.embedding;
  } catch (err) {
    throw tag(err, "embed");
  }
}

async function generateScore(
  item: Item,
  enriched: EnrichOutput,
  policy: PolicyT,
  treatment: EnrichTreatment,
): Promise<ScoreOutput> {
  try {
    const result = await generateStructured({
      ...(treatment === "fast" ? profiles.fastText : profiles.score),
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
            bodyMd: item.bodyMd,
          }),
        },
      ],
      schema: scoreSchema,
      schemaName: "EditorialScore",
      maxTokens: 2048,
    });
    const scored = result.data;
    const zh = await generateChineseScoreRationale({
      title: item.title,
      summaryZh: enriched.summaryZh,
      tags: enriched.tags,
      score: scored,
      itemId: item.id,
      treatment,
    });
    return {
      ...scored,
      reasoningZh: zh.reasoningZh,
      hkr: {
        ...scored.hkr,
        reasonsZh: zh.hkrReasonsZh,
      },
    };
  } catch (err) {
    throw tag(err, "score");
  }
}

async function regenerateHighValueItem(
  item: Item,
  policy: PolicyT,
  neverExcludeSet: Set<string>,
): Promise<{
  enriched: EnrichOutput;
  embedding: number[];
  scored: ScoreOutput;
  finalTier: ScoreOutput["tier"];
}> {
  const enriched = await generateEnrichment(item, "high");
  const embedding = await generateEmbedding(item, enriched);
  const scored = await generateScore(item, enriched, policy, "high");
  const finalTier =
    neverExcludeSet.has(item.sourceId) && scored.tier === "excluded"
      ? "all"
      : scored.tier;
  return { enriched, embedding, scored, finalTier };
}

function tag(err: unknown, stage: string): Error {
  const base = err instanceof Error ? err : new Error(String(err));
  const wrapped = new StageError(stage, base.message);
  (wrapped as Error & { cause?: unknown }).cause = err;
  return wrapped;
}
