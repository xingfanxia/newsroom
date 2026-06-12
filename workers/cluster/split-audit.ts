/**
 * Stage B split audit guardrail.
 *
 * An item rejected from several distinct clusters is usually a topical near
 * neighbor, not the same real-world event. Stop feeding it back into fuzzy
 * joins after a few confirmed misses so cron does not spend arbitration calls
 * on the same story forever.
 */
export const MAX_DISTINCT_SPLIT_RETRIES_PER_ITEM = 3;

export function hasReachedSplitRejectionCap(rejectedClusterCount: number): boolean {
  return rejectedClusterCount >= MAX_DISTINCT_SPLIT_RETRIES_PER_ITEM;
}
