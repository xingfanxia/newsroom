/**
 * Stage B− (re-open) — un-verify clusters that drifted incoherent since their
 * last LLM verdict, so Stage B re-arbitrates them (W6a, 2026-07-12 audit).
 *
 * WHY: `clusters.verified_at` is otherwise a PERMANENT tombstone — a wrong
 * "keep" verdict is never revisited, so a fused cluster (the audit's 48183
 * glued the White-House-restriction event to the GPT-5.6 release) stays fused
 * forever. Stage A only ADDS members to a verified cluster; single-link
 * chaining can then stretch it well past the point the original verdict
 * covered.
 *
 * WHAT: for verified clusters that GREW since verification and whose max
 * intra-pair cosine distance now exceeds REOPEN_COHESION_DISTANCE, null
 * `verified_at`. The next Stage B tick re-arbitrates them (~1 cheap Haiku call
 * each) and either splits the off-topic members out or re-confirms.
 *
 * LOOP-SAFETY (the load-bearing invariant): the candidate predicate requires
 * `latest_member_at > verified_at`. Re-arbitration stamps `verified_at = now`;
 * with no new member, `latest_member_at` stays in the past, so the cluster is
 * NOT eligible again until a member actually joins. A cluster the arbitrator
 * keeps despite the distance is re-checked only when its membership next
 * changes — never every tick. No re-verify thrash, bounded LLM cost.
 *
 * Bounded (recency window + LIMIT) so the O(members²) pairwise scan per
 * candidate can't blow the cron budget. Idempotent given unchanged data.
 */
import type { Client } from "@libsql/client";
import { libsqlClient } from "@/db/client";

/** Cosine-distance ceiling for a verified cluster to stay "coherent". Above
 *  this, its members are too spread out to be one event — re-arbitrate. Chosen
 *  above the 0.25 Stage-A join threshold and the 0.35 cohesion gate so only a
 *  genuinely stretched cluster trips it, not borderline same-event coverage. */
export const REOPEN_COHESION_DISTANCE = 0.38;

const DEFAULT_RECENCY_HOURS = 72;
const DEFAULT_MAX_PER_RUN = 100;

export type ReopenReport = {
  apply: boolean;
  /** Cluster ids un-verified (or, in dry-run, that WOULD be). */
  reopened: number;
};

export type ReopenOpts = {
  /** false = dry-run (count only). true = null verified_at. */
  apply: boolean;
  /** Only consider clusters whose latest_member_at is within this window.
   *  Null = all-time (manual backfill). Undefined = default 72h. */
  recencyHours?: number | null;
  /** Max candidate clusters to scan. Null = no cap (backfill). Undefined =
   *  default 100. */
  maxPerRun?: number | null;
  /** Injectable libSQL client (behavioral tests); defaults to the shared one. */
  client?: Client;
};

export async function reopenIncoherentClusters(
  opts: ReopenOpts,
): Promise<ReopenReport> {
  const client = opts.client ?? libsqlClient();
  const now = Date.now();
  const recencyHours =
    opts.recencyHours === undefined ? DEFAULT_RECENCY_HOURS : opts.recencyHours;
  const maxPerRun =
    opts.maxPerRun === undefined ? DEFAULT_MAX_PER_RUN : opts.maxPerRun;

  const candidateFilters: string[] = [
    "c.verified_at IS NOT NULL",
    "c.latest_member_at IS NOT NULL",
    // Grew since verification — the loop-safety guard. Without it a kept-but-
    // distant cluster would re-open every tick.
    "c.latest_member_at > c.verified_at",
    "c.member_count >= 2",
  ];
  const args: number[] = [];
  if (recencyHours != null) {
    candidateFilters.push("c.latest_member_at > ?");
    args.push(now - recencyHours * 3_600_000);
  }
  const limitClause = maxPerRun == null ? "" : `LIMIT ${Number(maxPerRun)}`;

  // Find candidate clusters whose worst cross-member pair is too far apart to
  // still be one event. The self-join is over ONE cluster's members at a time
  // (ia.cluster_id = ib.cluster_id = cand.id), bounded by the candidate LIMIT.
  args.push(REOPEN_COHESION_DISTANCE);
  const breached = await client.execute({
    sql: `
      WITH candidates AS (
        SELECT c.id
        FROM clusters c
        WHERE ${candidateFilters.join("\n          AND ")}
        ORDER BY c.latest_member_at DESC
        ${limitClause}
      )
      SELECT cand.id AS cluster_id
      FROM candidates cand
      JOIN items ia ON ia.cluster_id = cand.id AND ia.embedding IS NOT NULL
      JOIN items ib ON ib.cluster_id = cand.id AND ib.embedding IS NOT NULL
        AND ia.id < ib.id
      GROUP BY cand.id
      HAVING MAX(vector_distance_cos(ia.embedding, ib.embedding)) > ?
    `,
    args,
  });

  const ids = breached.rows.map((r) => Number(r.cluster_id));
  if (ids.length === 0 || !opts.apply) {
    return { apply: opts.apply, reopened: ids.length };
  }

  // Null ONLY verified_at — deliberately NOT updated_at. Bumping updated_at
  // would make Stage C re-title a cluster whose membership hasn't changed yet
  // (a wasted Haiku call if arbitration then re-confirms it). If arbitration
  // splits it this tick, applySplitVerdict bumps updated_at itself and Stage C
  // re-titles then — only when membership actually changed.
  const placeholders = ids.map(() => "?").join(", ");
  const res = await client.execute({
    sql: `UPDATE clusters SET verified_at = NULL
          WHERE id IN (${placeholders})`,
    args: ids,
  });

  return { apply: true, reopened: res.rowsAffected };
}
