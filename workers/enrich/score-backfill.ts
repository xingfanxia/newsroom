/**
 * Score-only backfill — re-runs Stage-3 scoring on items that were enriched
 * before HKR was part of the schema. Picks items with `hkr IS NULL AND
 * enriched_at IS NOT NULL`, calls the scorer, persists hkr + importance +
 * tier + reasoning. Does NOT touch enrichment (title/summary/tags) or
 * embedding — those stay as-is.
 *
 * Cost: ~$0.008/item × ~150 items = ~$1.20 one-time sweep.
 */
import pLimit from "p-limit";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { items } from "@/db/schema";
import { generateStructured, profiles } from "@/lib/llm";
import {
  scoreSchema,
  scoreSystem,
  scoreUserPrompt,
  type ScoreOutput,
} from "./prompt";
import { generateChineseScoreRationale } from "./chinese";
import { loadPolicy } from "./policy";
import {
  applyNeverExcludeTierFloor,
  loadNeverExcludeSourceIds,
} from "./source-tier";
import { treatmentForScore, type EnrichTreatment } from "./treatment";
import { scoreBackfillPendingSql } from "./pending-predicates";

const CONCURRENCY = 30;
const MAX_PER_RUN = 300;

export type ScoreBackfillReport = {
  candidates: number;
  rescored: number;
  errored: number;
  durationMs: number;
  errors: { itemId: number; reason: string }[];
};

export async function runScoreBackfill(): Promise<ScoreBackfillReport> {
  const started = Date.now();
  const client = db();

  // Pick items that either lack HKR (pre-rubric rows), lack the bilingual
  // reasoning pair (pre-bilingual rows), or lack the per-axis reasons
  // (pre-reasons rows — the hkr jsonb has `h/k/r` booleans but no
  // `reasonsZh`/`reasonsEn`). Each case signals a stale score row.
  const pending = await client
    .select()
    .from(items)
    .where(scoreBackfillPendingSql(items))
    .limit(MAX_PER_RUN);

  if (pending.length === 0) {
    return {
      candidates: 0,
      rescored: 0,
      errored: 0,
      durationMs: Date.now() - started,
      errors: [],
    };
  }

  const policy = await loadPolicy();
  const neverExcludeSourceIds = await loadNeverExcludeSourceIds(client);
  const limit = pLimit(CONCURRENCY);
  const errors: { itemId: number; reason: string }[] = [];
  let rescored = 0;

  await Promise.allSettled(
    pending.map((item) =>
      limit(async () => {
        try {
          const tagBag = (item.tags ?? {}) as {
            capabilities?: string[];
            entities?: string[];
            topics?: string[];
          };
          const tags = {
            capabilities: (tagBag.capabilities ?? []) as [],
            entities: tagBag.entities ?? [],
            topics: (tagBag.topics ?? []) as [],
          };
          let s = await scoreItem({
            item,
            policyContent: policy.content,
            tags,
            treatment: "fast",
          });
          let finalTier = applyNeverExcludeTierFloor({
            sourceId: item.sourceId,
            tier: s.tier,
            neverExcludeSourceIds,
          });
          if (
            treatmentForScore({ importance: s.importance, tier: finalTier }) ===
            "high"
          ) {
            s = await scoreItem({
              item,
              policyContent: policy.content,
              tags,
              treatment: "high",
            });
            finalTier = applyNeverExcludeTierFloor({
              sourceId: item.sourceId,
              tier: s.tier,
              neverExcludeSourceIds,
            });
          }
          await client
            .update(items)
            .set({
              importance: s.importance,
              tier: finalTier,
              hkr: s.hkr,
              reasoningZh: s.reasoningZh,
              reasoningEn: s.reasoningEn,
              policyVersion: policy.version,
            })
            .where(eq(items.id, item.id));
          rescored++;
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
    rescored,
    errored: errors.length,
    durationMs: Date.now() - started,
    errors,
  };
}

async function scoreItem(args: {
  item: typeof items.$inferSelect;
  policyContent: string;
  tags: {
    capabilities: [];
    entities: string[];
    topics: [];
  };
  treatment: EnrichTreatment;
}): Promise<ScoreOutput> {
  const { item, policyContent, tags, treatment } = args;
  const result = await generateStructured({
    ...(treatment === "fast" ? profiles.fastText : profiles.score),
    task: "score",
    itemId: item.id,
    system: scoreSystem(policyContent),
    messages: [
      {
        role: "user",
        content: scoreUserPrompt({
          title: item.title,
          summaryZh: item.summaryZh ?? item.title,
          tags,
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
  const scored: ScoreOutput = result.data;
  const zh = await generateChineseScoreRationale({
    title: item.title,
    summaryZh: item.summaryZh ?? item.title,
    tags,
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
}
