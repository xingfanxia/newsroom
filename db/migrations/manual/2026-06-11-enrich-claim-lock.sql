-- Add an explicit enrich-worker claim/backoff state.
--
-- Why: `enriched_at IS NULL` alone is not a lock. Overlapping cron ticks and
-- manual backfills can otherwise spend LLM calls on the same item repeatedly
-- before the final `UPDATE ... WHERE enriched_at IS NULL` runs.

ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS enrich_claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS enrich_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS enrich_error TEXT;

CREATE INDEX IF NOT EXISTS items_enrich_claim_idx
  ON public.items (enrich_claimed_at)
  WHERE enriched_at IS NULL;
