-- Migration: enable_rls_all_public_tables
-- Date:      2026-04-28
-- Project:   lnpczearxstbepydqxth (newsroom-db)
-- Status:    APPLIED — committed for source-of-truth only
--
-- This migration was applied directly to the Supabase project via the
-- Supabase MCP `apply_migration` tool on 2026-04-28 (migration name:
-- `enable_rls_all_public_tables`). It is not run by drizzle-kit; this file
-- exists so the change is tracked in version control.
--
-- See docs/security/2026-04-28-rls-hardening.md for full context, rationale,
-- verification (Supabase advisor before/after), and the reversal procedure.
--
-- Why deny-all is safe here:
--   * The app uses Drizzle over the `postgres` driver as role
--     `postgres.lnpczearxstbepydqxth`, which has BYPASSRLS.
--   * The app does not import @supabase/supabase-js; the anon key is unused
--     in client bundles. However, the auto-exposed PostgREST endpoint at
--     https://lnpczearxstbepydqxth.supabase.co/rest/v1/ was publicly
--     reachable with the anon key. Enabling RLS with no policies = deny-all
--     to anon/authenticated via PostgREST.
--
-- This is defense-in-depth, not a fix for an active leak.

ALTER TABLE public.sources            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_health      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_items          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.items              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clusters           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cluster_splits     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.llm_usage          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.newsletters        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.column_qc_log      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_collections  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_tokens         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy_versions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.iteration_runs     ENABLE ROW LEVEL SECURITY;
