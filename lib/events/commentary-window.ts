/**
 * Scheduled Stage D should spend on currently active events, not silently drain
 * old backfill debt forever. Historical event-commentary sweeps belong in
 * operator backfill scripts where cost ceilings and dry-runs are explicit.
 */
export const EVENT_COMMENTARY_CRON_RECENCY_HOURS = 24;
