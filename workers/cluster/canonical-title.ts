import { eq, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { clusters, items, sources } from "@/db/schema";
import { generateStructured, LLMError } from "@/lib/llm";
import { canonicalTitleSystem, canonicalTitleUserPrompt } from "./prompt";

export const MAX_TITLES_PER_RUN = 15;

export type CanonicalTitleReport = {
  processed: number;
  generated: number;
  skipped: number;
  durationMs: number;
  errors: Array<{ clusterId: number; reason: string }>;
};

const canonicalTitleSchema = z.object({
  canonicalTitleZh: z.string().min(1).max(200),
  canonicalTitleEn: z.string().min(1).max(200),
});

/**
 * Stage C: Generate neutral canonical titles for multi-source clusters.
 *
 * Candidates:
 *  - member_count >= 2 (singletons are skipped)
 *  - canonical_title_zh IS NULL (never titled yet)
 *    OR updated_at > titled_at (membership grew / Stage B reshuffled)
 *
 * Ordered by member_count DESC, updated_at DESC to prioritise high-coverage
 * events. Capped at MAX_TITLES_PER_RUN per invocation.
 */
export async function runCanonicalTitleBatch(): Promise<CanonicalTitleReport> {
  const started = Date.now();
  const client = db();

  // Select candidates: multi-member clusters that need (re)titling.
  const candidates = await client
    .select({
      id: clusters.id,
      memberCount: clusters.memberCount,
      leadItemId: clusters.leadItemId,
      titledAt: clusters.titledAt,
      updatedAt: clusters.updatedAt,
    })
    .from(clusters)
    .where(
      sql`${clusters.memberCount} >= 2
        AND (
          ${clusters.canonicalTitleZh} IS NULL
          OR ${clusters.updatedAt} > ${clusters.titledAt}
        )`,
    )
    .orderBy(desc(clusters.memberCount), desc(clusters.updatedAt))
    .limit(MAX_TITLES_PER_RUN);

  const processed = candidates.length;
  let generated = 0;
  let skipped = 0;
  const errors: Array<{ clusterId: number; reason: string }> = [];

  for (const candidate of candidates) {
    try {
      await titleOneCluster(candidate.id, candidate.leadItemId);
      generated++;
    } catch (err) {
      const reason =
        err instanceof LLMError
          ? `llm_${err.provider}: ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      errors.push({ clusterId: candidate.id, reason });
    }
  }

  return {
    processed,
    generated,
    skipped,
    durationMs: Date.now() - started,
    errors,
  };
}

async function titleOneCluster(
  clusterId: number,
  leadItemId: number,
): Promise<void> {
  const client = db();

  // Load all member items joined with sources for locale-appropriate source name.
  const members = await client
    .select({
      itemId: items.id,
      titleZh: items.titleZh,
      titleEn: items.titleEn,
      summaryZh: items.summaryZh,
      summaryEn: items.summaryEn,
      sourceId: items.sourceId,
      sourceNameEn: sources.nameEn,
      sourceNameZh: sources.nameZh,
    })
    .from(items)
    .innerJoin(sources, eq(items.sourceId, sources.id))
    .where(eq(items.clusterId, clusterId));

  if (members.length === 0) {
    throw new Error(`cluster ${clusterId} has no member items`);
  }

  // Find the lead item for its summaries.
  const lead = members.find((m) => m.itemId === leadItemId) ?? members[0];

  const memberTitles = members.map((m) => ({
    zh: m.titleZh,
    en: m.titleEn,
    source: m.sourceNameEn ?? m.sourceId,
  }));

  const promptInput = {
    memberTitles,
    leadSummaryZh: lead.summaryZh ?? null,
    leadSummaryEn: lead.summaryEn ?? null,
  };

  const result = await generateStructured({
    // Haiku: cheap, fast, sufficient for title generation.
    provider: "anthropic",
    deployment: "claude-haiku-4-5",
    task: "other",
    system: canonicalTitleSystem,
    messages: [
      {
        role: "user",
        content: canonicalTitleUserPrompt(promptInput),
      },
    ],
    schema: canonicalTitleSchema,
    schemaName: "CanonicalTitle",
    maxTokens: 256,
  });

  await client
    .update(clusters)
    .set({
      canonicalTitleZh: result.data.canonicalTitleZh,
      canonicalTitleEn: result.data.canonicalTitleEn,
      titledAt: new Date(),
    })
    .where(eq(clusters.id, clusterId));
}
