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
import { and, eq, isNull, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { items } from "@/db/schema";
import { generateStructured, profiles } from "@/lib/llm";
import {
  scoreSchema,
  scoreSystem,
  scoreUserPrompt,
  type ScoreOutput,
} from "./prompt";
import { loadPolicy } from "./policy";

const CONCURRENCY = 10;
const MAX_PER_RUN = 200;

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

  const pending = await client
    .select()
    .from(items)
    .where(
      and(
        isNotNull(items.enrichedAt),
        sql`${items.hkr} IS NULL`,
      ),
    )
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
                  summaryZh: item.summaryZh ?? item.title,
                  tags: {
                    capabilities: (tagBag.capabilities ?? []) as [],
                    entities: tagBag.entities ?? [],
                    topics: (tagBag.topics ?? []) as [],
                  },
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
          const s: ScoreOutput = result.data;
          await client
            .update(items)
            .set({
              importance: s.importance,
              tier: s.tier,
              hkr: s.hkr,
              reasoning: s.reasoning,
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
