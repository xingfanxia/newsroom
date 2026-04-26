/**
 * Authority-aware lead-item picking for multi-member clusters.
 *
 * Stage A sets `cluster.lead_item_id` to whichever item happened to start
 * the cluster (first-to-arrive). For fast-moving stories, the first item
 * is usually a Reddit post or X tweet — not the vendor blog or major-media
 * coverage that joins minutes later. The cluster card on the feed then
 * displays the wrong source label, and Stage C's canonical-title prompt
 * over-indexes on the social/Reddit framing instead of the event itself.
 *
 * This module ranks members by source authority and item importance so a
 * cluster's lead reflects its strongest factual member — used by Stage C
 * and (optionally) by the post-merge re-arbitration loop.
 *
 * Authority ladder (matches sourceGroupEnum in db/schema.ts):
 *
 *   group              | base | rationale
 *   ───────────────────┼──────┼─────────────────────────────────────────────
 *   vendor-official    |  100 | source of truth for vendor announcements
 *   media              |   80 | major editorial outlets (Bloomberg/FT/HN/Verge/TC)
 *   research           |   80 | arXiv / paper feeds
 *   newsletter         |   50 |
 *   policy             |   50 |
 *   market             |   50 |
 *   podcast            |   40 |
 *   product            |   40 | Product Hunt — useful but not the source
 *   social             |   20 | X user accounts, Reddit — last resort
 *
 * Plus operator-set `source.priority` (lower number = higher rank): each
 * step away from the default of 2 shifts the score by 20. priority=1 → +20,
 * priority=2 → 0, priority=3 → -20.
 *
 * Plus item-level `importance` (0-100 from the enrich/scorer stages):
 * divided by 10 so it acts as a tiebreaker between same-group siblings
 * without overwhelming the group ranking.
 *
 * Tiebreak by `published_at` ASC — when scores are equal, the earlier-
 * published item is the primary source (it's the original; later coverage
 * is corroboration).
 */

import type { sourceGroupEnum } from "@/db/schema";

export type SourceGroup = (typeof sourceGroupEnum)["enumValues"][number];

const GROUP_AUTHORITY: Record<SourceGroup, number> = {
  "vendor-official": 100,
  media: 80,
  research: 80,
  newsletter: 50,
  policy: 50,
  market: 50,
  podcast: 40,
  product: 40,
  social: 20,
};

/** Priority offset: each integer step from the default (2) shifts score by 20. */
const PRIORITY_DEFAULT = 2;
const PRIORITY_STEP = 20;

export type LeadCandidate = {
  itemId: number;
  sourceGroup: SourceGroup;
  sourcePriority: number;
  importance: number | null;
  publishedAt: Date | string;
};

/**
 * Compute the authority score for a single candidate. Higher = better lead.
 *
 * Range under default config: ~140 (vendor-official, priority=1, importance=100)
 * down to ~0 (social, priority=3, importance=null). Most members fall in
 * 20-120 range.
 */
export function authorityScore(c: LeadCandidate): number {
  const groupBase = GROUP_AUTHORITY[c.sourceGroup] ?? 0;
  const priorityBonus = (PRIORITY_DEFAULT - c.sourcePriority) * PRIORITY_STEP;
  const importanceBonus = (c.importance ?? 0) / 10;
  return groupBase + priorityBonus + importanceBonus;
}

/**
 * Pick the best lead candidate from a non-empty member list.
 *
 * Tiebreaks:
 *   1. Highest authorityScore wins.
 *   2. Earlier publishedAt wins (the original story; later coverage is
 *      corroboration).
 *   3. Lowest itemId wins (deterministic — the earlier-clustered item).
 *
 * Throws if `members` is empty — Stage C should never call this on an empty
 * cluster (the surrounding code already validates membership).
 */
export function pickBestLead<T extends LeadCandidate>(members: T[]): T {
  if (members.length === 0) {
    throw new Error("pickBestLead: empty member list");
  }

  let best = members[0];
  let bestScore = authorityScore(best);

  for (let i = 1; i < members.length; i++) {
    const m = members[i];
    const score = authorityScore(m);

    if (score > bestScore) {
      best = m;
      bestScore = score;
      continue;
    }
    if (score < bestScore) continue;

    // Tied scores — earlier publishedAt wins.
    const bestTime = new Date(best.publishedAt).getTime();
    const mTime = new Date(m.publishedAt).getTime();
    if (mTime < bestTime) {
      best = m;
      continue;
    }
    if (mTime > bestTime) continue;

    // Same score, same time — lowest itemId wins (deterministic).
    if (m.itemId < best.itemId) best = m;
  }

  return best;
}
