import pLimit from "p-limit";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { embeddingToSmall, items } from "@/db/schema";
import type { Item } from "@/db/schema";
import {
  generateStructured,
  embed,
  profiles,
  LLMError,
} from "@/lib/llm";
import { VISIBLE_ITEM_TIERS } from "@/lib/types";
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
import { ENRICH_CLAIM_RESET_VALUES } from "./claim-state";
import { loadPolicy } from "./policy";
import {
  applyNeverExcludeTierFloor,
  loadNeverExcludeSourceIds,
  type NeverExcludeSourceIds,
} from "./source-tier";
import { treatmentForScore, type EnrichTreatment } from "./treatment";
import {
  ENRICH_MAX_ATTEMPTS,
  enrichClaimableSql,
} from "./pending-predicates";

// Enrich does stages 1-3 (summary + tags → embed → score). Commentary used
// to be stage 4 here but was failing silently with Azure's "No object
// generated" on the long-form prompt, AND blocking enrich's throughput
// because each worker waited on a 20-40s commentary call. It's now a
// separate worker (workers/enrich/commentary.ts) that runs in parallel
// at its own concurrency, and retries independently.
// Keep cron throughput bounded. Backfills can opt into higher values via
// EnrichBatchOptions, but the scheduled worker should not be able to spend
// thousands of LLM calls in one burst.
const CONCURRENCY = 10;
const MAX_PER_RUN = 60;
export type EnrichReport = {
  processed: number;
  enriched: number;
  errored: number;
  durationMs: number;
  errors: { itemId: number; stage: string; code: string }[];
};

export type EnrichBatchOptions = {
  limit?: number;
  concurrency?: number;
  maxAttempts?: number;
  windowStart?: Date;
  windowEnd?: Date;
};

export async function runEnrichBatch(
  opts: EnrichBatchOptions = {},
): Promise<EnrichReport> {
  const started = Date.now();
  const client = db();
  const pending = await claimPendingEnrichItems(client, opts);

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
  const neverExcludeSourceIds = await loadNeverExcludeSourceIds(client);

  const limit = pLimit(opts.concurrency ?? CONCURRENCY);
  const errors: { itemId: number; stage: string; code: string }[] = [];
  let enriched = 0;

  await Promise.allSettled(
    pending.map((item) =>
      limit(async () => {
        try {
          await enrichOne(item, policy, neverExcludeSourceIds);
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
          await markEnrichFailure(item.id, stage, code, err);
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

async function claimPendingEnrichItems(
  client: ReturnType<typeof db>,
  opts: EnrichBatchOptions,
): Promise<Item[]> {
  const limit = opts.limit ?? MAX_PER_RUN;
  const maxAttempts = opts.maxAttempts ?? ENRICH_MAX_ATTEMPTS;
  const filters = [
    enrichClaimableSql(items, { maxAttempts }),
  ];
  if (opts.windowStart) {
    filters.push(sql`${items.publishedAt} >= ${opts.windowStart.getTime()}`);
  }
  if (opts.windowEnd) {
    filters.push(sql`${items.publishedAt} < ${opts.windowEnd.getTime()}`);
  }

  // Priority order:
  //   1. items that were previously tiered non-excluded (featured/p1/all)
  //      and are now unenriched — these are the curated cards readers see
  //      AND we usually reset them deliberately to re-run with new prompts.
  //   2. items that have bodyMd (Jina/article-body already fetched) —
  //      they'll benefit from a richer enrichment than a title-only item.
  //   3. most-recent-first by publishedAt.
  //
  // Claim atomicity: this was `SELECT ... FOR UPDATE SKIP LOCKED` + a
  // writable CTE on Postgres. SQLite has no row locks and no data-modifying
  // CTEs — instead the whole claim is ONE UPDATE statement, and SQLite's
  // single-writer serialization makes it atomic: a concurrent cron's claim
  // runs strictly before or after this one, and whichever runs second
  // re-evaluates the claimable predicate (enrich_claimed_at freshness), so
  // the two claims never overlap.
  const claimedRows = await client.all<{ id: number }>(sql`
    UPDATE ${items}
    SET
      enrich_claimed_at = ${Date.now()},
      enrich_attempts = coalesce(enrich_attempts, 0) + 1,
      enrich_error = NULL
    WHERE ${items.id} IN (
      SELECT ${items.id}
      FROM ${items}
      WHERE ${and(...filters)}
      ORDER BY
        CASE
          WHEN ${inArray(items.tier, VISIBLE_ITEM_TIERS)} THEN 0
          WHEN ${items.bodyMd} IS NOT NULL THEN 1
          WHEN ${items.tier} = 'excluded' THEN 3
          ELSE 2
        END,
        ${items.publishedAt} DESC
      LIMIT ${limit}
    )
    RETURNING ${items.id} AS id
  `);

  const ids = claimedRows.map((r) => Number(r.id));
  if (ids.length === 0) return [];

  const rows = await client.select().from(items).where(inArray(items.id, ids));
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => byId.get(id)).filter((row): row is Item => Boolean(row));
}

async function markEnrichFailure(
  itemId: number,
  stage: string,
  code: string,
  err: unknown,
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  const enrichError = `${stage}:${code}: ${message}`.slice(0, 500);
  await db()
    .update(items)
    .set({
      enrichClaimedAt: new Date(),
      enrichError,
    })
    .where(and(eq(items.id, itemId), isNull(items.enrichedAt)));
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
  neverExcludeSourceIds: NeverExcludeSourceIds,
): Promise<void> {
  const client = db();

  let enriched = await generateEnrichment(item, "fast");
  let embedding = await generateEmbedding(item, enriched);
  let scored = await generateScore(item, enriched, policy, "fast");

  const finalTier = applyNeverExcludeTierFloor({
    sourceId: item.sourceId,
    tier: scored.tier,
    neverExcludeSourceIds,
  });

  let effectiveTier = finalTier;
  if (
    treatmentForScore({ importance: scored.importance, tier: finalTier }) ===
    "high"
  ) {
    const upgraded = await regenerateHighValueItem(
      item,
      policy,
      neverExcludeSourceIds,
    );
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
      embeddingSmall: embeddingToSmall(embedding),
      enrichedAt: new Date(),
      ...ENRICH_CLAIM_RESET_VALUES,
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
  neverExcludeSourceIds: NeverExcludeSourceIds,
): Promise<{
  enriched: EnrichOutput;
  embedding: number[];
  scored: ScoreOutput;
  finalTier: ScoreOutput["tier"];
}> {
  const enriched = await generateEnrichment(item, "high");
  const embedding = await generateEmbedding(item, enriched);
  const scored = await generateScore(item, enriched, policy, "high");
  const finalTier = applyNeverExcludeTierFloor({
    sourceId: item.sourceId,
    tier: scored.tier,
    neverExcludeSourceIds,
  });
  return { enriched, embedding, scored, finalTier };
}

function tag(err: unknown, stage: string): Error {
  const base = err instanceof Error ? err : new Error(String(err));
  const wrapped = new StageError(stage, base.message);
  (wrapped as Error & { cause?: unknown }).cause = err;
  return wrapped;
}
