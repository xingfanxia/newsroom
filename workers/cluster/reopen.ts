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
 * WHAT: for verified clusters that GREW since verification and where some
 * member has drifted more than REOPEN_COHESION_DISTANCE from the cluster LEAD,
 * null `verified_at` (and the members' `cluster_verified_at`, see below). The
 * next Stage B tick re-arbitrates them (~1 cheap Haiku call each) and either
 * splits the off-topic members out or re-confirms.
 *
 * COHESION DEFINITION — member-to-lead, not all-pairs (deliberate):
 *   Stage A admits a member only when it is within COHESION_MAX_DISTANCE (0.35)
 *   of the cluster lead. Re-open therefore asks the SAME question, in reverse:
 *   "has any member drifted beyond that gate?" — max member-to-lead distance >
 *   REOPEN_COHESION_DISTANCE. Using the lead as the anchor (rather than the
 *   worst cross-member pair) keeps the metric consistent with the join gate and
 *   makes the scan O(members), not O(members²), so a fused mega-cluster — the
 *   exact large-member case re-open targets — can't blow the cron budget.
 *   REOPEN_COHESION_DISTANCE (0.38) sits a 0.03 hysteresis band ABOVE the 0.35
 *   join gate, so a member sitting right at the gate boundary can't thrash.
 *
 * EMBEDDING SPACE — full `embedding` (3072-dim), NOT `embedding_small`:
 *   The 0.25 join / 0.35 cohesion / 0.38 re-open thresholds are all calibrated
 *   in the full-embedding cosine space that Stage A + A.5 use. Swapping in the
 *   256-dim `embedding_small` would put 0.38 in a DIFFERENT distance
 *   distribution and silently break that calibration — do NOT "optimize" this
 *   to the small vector without re-tuning every threshold together.
 *
 * LOOP-SAFETY (the load-bearing invariant): the candidate predicate requires
 * `latest_member_at > verified_at`. Re-arbitration stamps `verified_at = now`;
 * with no new member, `latest_member_at` stays in the past, so the cluster is
 * NOT eligible again until a member actually joins. A cluster the arbitrator
 * keeps despite the distance is re-checked only when its membership next
 * changes — never every tick. No re-verify thrash, bounded LLM cost.
 *
 * Bounded (recency window + LIMIT). Idempotent given unchanged data.
 */
import type { Client } from "@libsql/client";
import { libsqlClient } from "@/db/client";

/** Cosine-distance ceiling for a verified cluster to stay "coherent". Above
 *  this, a member has drifted too far from the lead to be the same event —
 *  re-arbitrate. Chosen a 0.03 hysteresis band above the 0.35 Stage-A cohesion
 *  gate (itself above the 0.25 join threshold) so only a genuinely stretched
 *  cluster trips it, not borderline same-event coverage. */
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

  // Find candidate clusters where some member has drifted beyond the cohesion
  // gate from the LEAD (see "COHESION DEFINITION" above). One distance per
  // non-lead member vs the single lead embedding — O(members), not O(members²).
  args.push(REOPEN_COHESION_DISTANCE);
  const breached = await client.execute({
    sql: `
      WITH candidates AS (
        SELECT c.id, c.lead_item_id
        FROM clusters c
        WHERE ${candidateFilters.join("\n          AND ")}
        ORDER BY c.latest_member_at DESC
        ${limitClause}
      )
      SELECT cand.id AS cluster_id
      FROM candidates cand
      JOIN items lead ON lead.id = cand.lead_item_id
        AND lead.embedding IS NOT NULL
      JOIN items m ON m.cluster_id = cand.id AND m.id != cand.lead_item_id
        AND m.embedding IS NOT NULL
      GROUP BY cand.id
      HAVING MAX(vector_distance_cos(m.embedding, lead.embedding)) > ?
    `,
    args,
  });

  const ids = breached.rows.map((r) => Number(r.cluster_id));
  if (ids.length === 0 || !opts.apply) {
    return { apply: opts.apply, reopened: ids.length };
  }

  // Void the verdict atomically at BOTH levels:
  //  - clusters.verified_at → NULL   (re-triggers Stage B arbitration)
  //  - members' cluster_verified_at → NULL
  // The member-level null is what keeps a subsequent lone-survivor split
  // visible to A.5 (singletons.ts keys off `cluster_verified_at IS NULL`).
  // Without it, a re-opened cluster re-split down to a single ORIGINAL member
  // would keep that member's stale stamp from the prior keep verdict and be
  // orphaned from A.5 forever. batch() runs both in one write transaction so a
  // crash can't leave the cluster unverified but its members still stamped.
  //
  // Deliberately NOT touching updated_at — bumping it would make Stage C
  // re-title a cluster whose membership hasn't changed yet (a wasted Haiku call
  // if arbitration then re-confirms it). If arbitration splits it this tick,
  // applySplitVerdict bumps updated_at itself and Stage C re-titles then.
  const placeholders = ids.map(() => "?").join(", ");
  const [clusterRes] = await client.batch(
    [
      {
        sql: `UPDATE clusters SET verified_at = NULL
              WHERE id IN (${placeholders})`,
        args: ids,
      },
      {
        sql: `UPDATE items SET cluster_verified_at = NULL
              WHERE cluster_id IN (${placeholders})
                AND cluster_verified_at IS NOT NULL`,
        args: ids,
      },
    ],
    "write",
  );

  return { apply: true, reopened: clusterRes.rowsAffected };
}
