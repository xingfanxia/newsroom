-- Migration: aihot-integration
-- Date:      2026-05-08
-- Status:    PENDING — apply via drizzle-kit push or Supabase MCP apply_migration
--
-- Two additive changes:
--   1. Add 'aihot-api' value to source_kind enum so the AI HOT source can
--      register a row in `sources` and dispatch through workers/fetcher.
--   2. Add `aihot_daily_payload` (jsonb) and `aihot_daily_date` (text) columns
--      to `newsletters` so the daily column generator can cache + reuse
--      AI HOT's /api/public/daily response per day.
--
-- Both changes are additive and safe to roll back by `ALTER TABLE DROP COLUMN`
-- (newsletters cols) — enum value addition cannot be removed without a full
-- type rebuild, but harmless if left in place.
--
-- See docs/aihot-integration/PLAN.md for the integration design.

-- ── 1. source_kind enum ───────────────────────────────────────────────────
ALTER TYPE source_kind ADD VALUE IF NOT EXISTS 'aihot-api';

-- ── 2. newsletters columns ────────────────────────────────────────────────
ALTER TABLE public.newsletters
  ADD COLUMN IF NOT EXISTS aihot_daily_payload jsonb,
  ADD COLUMN IF NOT EXISTS aihot_daily_date    text;

-- ── 3. comment for clarity ────────────────────────────────────────────────
COMMENT ON COLUMN public.newsletters.aihot_daily_payload IS
  'Full AI HOT /api/public/daily response merged in as must-cover signal. NULL when AI HOT was unavailable. See docs/aihot-integration/PLAN.md.';
COMMENT ON COLUMN public.newsletters.aihot_daily_date IS
  'Which AI HOT date (YYYY-MM-DD UTC) got merged in. Lookup key for the daily-column generator cache. NULL when no payload.';
