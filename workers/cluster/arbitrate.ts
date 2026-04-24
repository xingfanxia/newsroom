/**
 * Stage B LLM arbitrator — keep-or-split verdicts for candidate clusters.
 *
 * Looks at clusters with member_count >= 2 that haven't been LLM-verified yet
 * (or have new unverified members), calls Haiku to decide whether all members
 * truly cover the same real-world event, and either:
 *   - "keep": stamps verified_at on the cluster + cluster_verified_at on all members
 *   - "split": unlinks rejected items, writes cluster_splits audit rows, decrements member_count
 *
 * After each verdict, recomputes event importance + approximate tier and persists
 * to clusters.importance / clusters.event_tier.
 */

import { and, eq, isNull, or, sql, exists } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { clusters, items, sources, clusterSplits } from "@/db/schema";
import { generateStructured } from "@/lib/llm";
import {
  recomputeEventImportance,
  approximateTierForImportance,
} from "./importance";
import { arbitrateSystem, arbitrateUserPrompt } from "./prompt";

/** Drizzle transaction client — same shape as the top-level db() client. */
type DbTx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

export const MAX_ARBITRATIONS_PER_RUN = 15;

export type ArbitrationReport = {
  processed: number;
  keptClusters: number;
  splitClusters: number;
  itemsMoved: number;
  durationMs: number;
  errors: Array<{ clusterId: number; reason: string }>;
};

// Zod schema for the LLM response
const arbitrateResponseSchema = z.object({
  verdict: z.enum(["keep", "split"]),
  rejectedMemberIds: z.array(z.number()).optional(),
  reason: z.string().max(280),
});

type ArbitrateResponse = z.infer<typeof arbitrateResponseSchema>;

type CandidateCluster = {
  id: number;
  leadItemId: number;
  memberCount: number;
};

type MemberRow = {
  itemId: number;
  titleZh: string | null;
  titleEn: string | null;
  rawTitle: string;
  publishedAt: string;
  sourceName: string;
  importance: number | null;
};

/** Raw DB row as returned by the members SELECT (before mapping publishedAt). */
type MemberDbRow = {
  itemId: number;
  titleZh: string | null;
  titleEn: string | null;
  rawTitle: string;
  publishedAt: Date;
  sourceName: string;
  importance: number | null;
};

export async function runArbitrationBatch(): Promise<ArbitrationReport> {
  const started = Date.now();
  const client = db();

  // Select clusters that need arbitration:
  // - member_count >= 2
  // - either no verified_at OR has members with no cluster_verified_at
  const candidates = await client
    .select({
      id: clusters.id,
      leadItemId: clusters.leadItemId,
      memberCount: clusters.memberCount,
    })
    .from(clusters)
    .where(
      and(
        sql`${clusters.memberCount} >= 2`,
        or(
          isNull(clusters.verifiedAt),
          exists(
            client
              .select({ one: sql`1` })
              .from(items)
              .where(
                and(
                  eq(items.clusterId, clusters.id),
                  isNull(items.clusterVerifiedAt),
                ),
              ),
          ),
        ),
      ),
    )
    .orderBy(sql`${clusters.memberCount} DESC, ${clusters.updatedAt} DESC`)
    .limit(MAX_ARBITRATIONS_PER_RUN);

  if (candidates.length === 0) {
    return {
      processed: 0,
      keptClusters: 0,
      splitClusters: 0,
      itemsMoved: 0,
      durationMs: Date.now() - started,
      errors: [],
    };
  }

  let keptClusters = 0;
  let splitClusters = 0;
  let itemsMoved = 0;
  const errors: Array<{ clusterId: number; reason: string }> = [];

  for (const candidate of candidates) {
    try {
      const result = await arbitrateOne(candidate);
      if (result.verdict === "keep") {
        keptClusters++;
      } else {
        splitClusters++;
        itemsMoved += result.itemsMoved;
      }
    } catch (err) {
      errors.push({
        clusterId: candidate.id,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    processed: candidates.length,
    keptClusters,
    splitClusters,
    itemsMoved,
    durationMs: Date.now() - started,
    errors,
  };
}

type ArbitrateOneResult =
  | { verdict: "keep" }
  | { verdict: "split"; itemsMoved: number };

async function arbitrateOne(
  candidate: CandidateCluster,
): Promise<ArbitrateOneResult> {
  const client = db();

  // Load all members with their source names
  const memberRows = await client
    .select({
      itemId: items.id,
      titleZh: items.titleZh,
      titleEn: items.titleEn,
      rawTitle: items.title,
      publishedAt: items.publishedAt,
      sourceName: sources.nameEn,
      importance: items.importance,
    })
    .from(items)
    .innerJoin(sources, eq(items.sourceId, sources.id))
    .where(eq(items.clusterId, candidate.id));

  if (memberRows.length === 0) {
    // Cluster has no members in DB (race condition) — skip
    return { verdict: "keep" };
  }

  // Load lead item's summaryZh for context
  const leadRows = await client
    .select({ summaryZh: items.summaryZh })
    .from(items)
    .where(eq(items.id, candidate.leadItemId))
    .limit(1);

  const leadSummary = leadRows[0]?.summaryZh ?? null;

  // Build member list for the prompt
  const members: MemberRow[] = (memberRows as MemberDbRow[]).map((r) => ({
    ...r,
    publishedAt: r.publishedAt.toISOString(),
  }));

  // Call Haiku — use enrich profile (azure-openai + low reasoning = fast + cheap)
  const llmResult = await generateStructured({
    provider: "azure-openai",
    reasoningEffort: "low",
    task: "arbitrate",
    system: arbitrateSystem,
    messages: [
      {
        role: "user",
        content: arbitrateUserPrompt({
          clusterId: candidate.id,
          members: members.map((m) => ({
            itemId: m.itemId,
            titleZh: m.titleZh,
            titleEn: m.titleEn,
            rawTitle: m.rawTitle,
            publishedAt: m.publishedAt,
            sourceName: m.sourceName,
          })),
          leadSummary,
        }),
      },
    ],
    schema: arbitrateResponseSchema,
    schemaName: "ArbitrateVerdict",
    maxTokens: 512,
  });

  const verdict: ArbitrateResponse = llmResult.data;

  if (verdict.verdict === "keep") {
    await applyKeepVerdict(candidate.id, members);
    return { verdict: "keep" };
  } else {
    const rejectedIds = verdict.rejectedMemberIds ?? [];
    const moved = await applySplitVerdict(
      candidate.id,
      members,
      rejectedIds,
      verdict.reason,
    );
    return { verdict: "split", itemsMoved: moved };
  }
}

async function applyKeepVerdict(
  clusterId: number,
  members: MemberRow[],
): Promise<void> {
  const client = db();
  const now = new Date();

  await client.transaction(async (tx: DbTx) => {
    // Stamp verified_at on the cluster
    await tx
      .update(clusters)
      .set({ verifiedAt: now, updatedAt: now })
      .where(eq(clusters.id, clusterId));

    // Stamp cluster_verified_at on all unverified members
    await tx
      .update(items)
      .set({ clusterVerifiedAt: now })
      .where(
        and(eq(items.clusterId, clusterId), isNull(items.clusterVerifiedAt)),
      );
  });

  // Recompute importance outside transaction (read + write, no atomicity needed)
  await persistImportance(clusterId, members);
}

async function applySplitVerdict(
  clusterId: number,
  members: MemberRow[],
  rejectedIds: number[],
  reason: string,
): Promise<number> {
  if (rejectedIds.length === 0) {
    // LLM said split but gave no IDs — treat as keep
    await applyKeepVerdict(clusterId, members);
    return 0;
  }

  const client = db();
  const now = new Date();
  const rejectedSet = new Set(rejectedIds);

  await client.transaction(async (tx: DbTx) => {
    // Unlink each rejected item
    for (const itemId of rejectedIds) {
      await tx
        .update(items)
        .set({
          clusterId: null,
          clusteredAt: null,
          clusterVerifiedAt: null,
        })
        .where(eq(items.id, itemId));

      // Write audit row
      await tx.insert(clusterSplits).values({
        itemId,
        fromClusterId: clusterId,
        reason,
      });
    }

    // Decrement member_count by the number of rejected items
    await tx
      .update(clusters)
      .set({
        memberCount: sql`${clusters.memberCount} - ${rejectedIds.length}`,
        updatedAt: now,
      })
      .where(eq(clusters.id, clusterId));

    // Verify surviving members
    await tx
      .update(items)
      .set({ clusterVerifiedAt: now })
      .where(
        and(eq(items.clusterId, clusterId), isNull(items.clusterVerifiedAt)),
      );

    // Stamp verified_at on the cluster (survivors are now confirmed)
    await tx
      .update(clusters)
      .set({ verifiedAt: now })
      .where(eq(clusters.id, clusterId));
  });

  // Recompute importance for surviving members
  const survivors = members.filter((m) => !rejectedSet.has(m.itemId));
  if (survivors.length > 0) {
    await persistImportance(clusterId, survivors);
  }

  return rejectedIds.length;
}

async function persistImportance(
  clusterId: number,
  members: MemberRow[],
): Promise<void> {
  const client = db();

  const { importance } = recomputeEventImportance(
    members.map((m) => ({ importance: m.importance })),
  );
  const eventTier = approximateTierForImportance(importance);

  await client
    .update(clusters)
    .set({ importance, eventTier, updatedAt: new Date() })
    .where(eq(clusters.id, clusterId));
}
