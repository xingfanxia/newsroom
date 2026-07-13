/**
 * Scheduled Stage D should spend on currently active events, not silently drain
 * old backfill debt forever. Historical event-commentary sweeps belong in
 * operator backfill scripts where cost ceilings and dry-runs are explicit.
 *
 * Sized against the cluster cadence (W9: 3×/day = every 8h): 36h keeps an event
 * in the candidate window for ~4 cluster runs, so a low-importance event that
 * loses the per-run importance-DESC race still gets several chances at an editor
 * note before it ages out (a bare multi-source card is otherwise unrecoverable
 * except by a manual backfill). Still bounded — not a forever-drain.
 */
export const EVENT_COMMENTARY_CRON_RECENCY_HOURS = 36;
