# RLS Hardening — All Public Tables (newsroom-db)

- **Date:** 2026-04-28
- **Project ID:** `lnpczearxstbepydqxth` (newsroom-db)
- **Scope:** All 15 tables in the `public` schema
- **Migration name:** `enable_rls_all_public_tables` (applied via Supabase `apply_migration`)
- **Author:** Applied directly through Supabase MCP on 2026-04-28; recorded into the repo for source-of-truth.

## Summary

Enabled Row Level Security (RLS) on every table in the `public` schema. **No policies are
attached** — this is intentional. With RLS on and no policy, PostgREST (anon/authenticated
roles) is denied by default for all reads and writes. Service-role and direct-Postgres
connections (Drizzle) are unaffected.

This is **defense-in-depth, not a fix for an active leak**. There is no evidence of
unauthorized access — see "Why this is safe" below.

## Scope (tables affected)

```
sources, source_health, raw_items, items, clusters, cluster_splits,
llm_usage, newsletters, column_qc_log, feedback, saved_collections,
users, api_tokens, policy_versions, iteration_runs
```

## SQL applied

```sql
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
```

A copy of this exact statement is kept under
[`db/migrations/manual/2026-04-28-rls-hardening.sql`](../../db/migrations/manual/2026-04-28-rls-hardening.sql)
as source-of-truth.

## Why this is safe (Drizzle/postgres bypass)

The application reaches Supabase Postgres via Drizzle over the `postgres` driver, using
the pooler endpoint:

- **Host:** `aws-1-us-west-1.pooler.supabase.com`
- **Role:** `postgres.lnpczearxstbepydqxth`

This role has the `BYPASSRLS` attribute (verified before applying the migration), so all
existing application queries continue to work unchanged after RLS is enabled.

The app code does **not** import `@supabase/supabase-js` and does not use the anon key
in any client bundle. However, every Supabase project automatically exposes a PostgREST
endpoint at:

```
https://lnpczearxstbepydqxth.supabase.co/rest/v1/
```

…that anyone with the publicly-distributed anon key can hit. Until this migration, those
tables were reachable through that endpoint with anon credentials. Enabling RLS with no
policies closes that surface.

## Verification

Re-ran the Supabase advisor immediately after the migration:

| Check | Before | After |
|---|---|---|
| `rls_disabled_in_public` (ERROR) | 15 | 0 |
| `rls_enabled_no_policy` (INFO) | 0 | 15 |

The 15 INFO results post-migration are intentional and reflect the deny-all-via-PostgREST
design.

## Reversal procedure

If RLS needs to be removed from any table (e.g., to expose it via PostgREST in the
future), run the corresponding statement(s) below. Reversal can be done per-table; you
do **not** need to roll back the whole migration.

```sql
ALTER TABLE public.sources            DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_health      DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_items          DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.items              DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.clusters           DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.cluster_splits     DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.llm_usage          DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.newsletters        DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.column_qc_log      DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback           DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_collections  DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.users              DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_tokens         DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy_versions    DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.iteration_runs     DISABLE ROW LEVEL SECURITY;
```

The preferred way to expose a specific table to anon/authenticated PostgREST clients in
the future is to **add a tailored policy**, not to disable RLS on the table.

## Future work

- If/when client-side Supabase access is ever needed, write per-table policies instead
  of disabling RLS (e.g., `CREATE POLICY "read public sources" ON public.sources FOR
  SELECT TO anon USING (true);`).
- Consider rotating the anon key as a hygiene step, since it has been publicly
  distributable.
