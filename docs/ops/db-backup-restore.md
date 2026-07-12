# DB backup & restore — Turso `newsroom-v2`

Since the Supabase→Turso migration (2026-07-11), **Turso `newsroom-v2` is the
only copy of the data.** Supabase is deleted, the Turso Starter plan has no
point-in-time recovery, and the DB is single-region (`aws-us-west-2`). This
doc is the recovery story that closes that P0 (residue audit 2026-07-12).

## Guardrails now in place

- **`delete_protection` is ON** (enabled 2026-07-12 via the Turso platform API).
  Confirm/read:
  ```bash
  TOKEN=$(grep -E '^TURSO_API_TOKEN=' ~/.claude/turso.env | cut -d= -f2-)
  curl -s -H "Authorization: Bearer $TOKEN" \
    https://api.turso.tech/v1/organizations/xingfanxia/databases/newsroom-v2/configuration
  # => {"...","delete_protection":true}
  ```
  To DROP the DB you must first PATCH `delete_protection:false` — a deliberate
  two-step, no accidental one-command drop.
- **`db:push` is neutered** (`package.json`) — it exits 1 with a pointer here.
  `drizzle-kit push --force` applied a known F32_BLOB false-diff that DROPS
  `items.embedding` + the DiskANN index. Schema changes go through ordered
  raw-SQL ops scripts (`scripts/ops/db-optimize.ts` pattern) + the
  `schema_migrations` ledger — never drizzle-kit against the live DB.

## Taking a backup

```bash
bun --env-file=.env.local scripts/ops/db-dump.ts            # → ./backups/<UTC-stamp>/
bun --env-file=.env.local scripts/ops/db-dump.ts --out /some/dir
```

- One gzipped JSONL file per table + `manifest.json` (per-table row counts).
- Blob columns (`items.embedding` F32_BLOB, `items.embedding_small`) are
  captured losslessly as `{"$blob":"<base64>"}` — the vectors are the single
  most expensive-to-regenerate data, so they are in the dump verbatim.
- Timestamps are raw integer ms (read through the raw libSQL client, no Date
  coercion), matching the on-disk representation.
- **Parity**: each table's written line count is checked against a fresh
  `COUNT(*)`; any mismatch fails the run (exit 1). A dump that reports
  `DB DUMP DONE` is byte-count-trustworthy.
- `./backups/` is git-ignored. A full dump today is ~346 MB (317 MB is the
  `items` embeddings).

Reference dump 2026-07-12 (all 15 tables parity-OK): `items` 21 533 ·
`raw_items` 21 533 · `clusters` 16 329 · `cluster_splits` 58 190 ·
`llm_usage` 364 839 · `newsletters` 110 · `sources` 55 · `source_health` 55 ·
`column_qc_log` 30 · `feedback` 10 · `api_tokens` 3 · `users` 2 ·
`policy_versions` 2 · `iteration_runs` 0 · `saved_collections` 0.

## Restore

The two realistic disaster scenarios and their recovery:

### A. A schema change dropped a column / index (e.g. `items.embedding`)

Most likely failure and the reason `db:push` is neutered. You do **not** need a
full DB rebuild — restore the affected column from the latest dump:

1. Recreate the column/table via a raw-SQL ops script (never drizzle-kit).
2. For each row in the dump, decode `{"$blob":"<base64>"}` back to bytes and
   bind it as a blob (`Buffer.from(b64,"base64")` → libSQL binds `Uint8Array`
   as a BLOB, reconstructing the exact F32_BLOB). Timestamps/JSON go back as-is.
3. Rebuild the DiskANN index **incrementally** with
   `scripts/ops/backfill-embedding-small.ts` — **never** bulk-`CREATE INDEX` on
   a vector column on Turso.

### B. Total DB loss (must recreate `newsroom-v2` from zero)

1. Create a fresh Turso DB, apply the base DDL (the schema in `db/schema.ts` via
   the ordered raw-SQL runner — see `docs/HANDOFF.md § Turso` / TURSO-1).
2. Insert rows per table from the dump (blobs decoded as in A.2), in FK-safe
   order: `sources` → `raw_items` → `items` → `clusters` → `cluster_splits` /
   `feedback` / `saved_collections`, then the independent tables.
3. Rebuild `items_embedding_small_idx` incrementally (as A.3).
4. `bun run db:optimize` to recreate the non-vector perf indexes + verify plans.
5. Point `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` at the new DB.

A row-level insert helper (`Buffer.from(v.$blob,"base64")` for `$blob`,
`BigInt(v.$bigint)` for `$bigint`, else the value) is a ~40-line loop over the
gunzipped JSONL; keep inserts batched and run under `node
--experimental-strip-types`, not bun (bun 1.3.1 corrupts large `@libsql/client`
write batches — see HANDOFF).

## Documented follow-ups (not done this pass — no off-box creds today)

`.env.local` has no `R2_*` / `S3` credentials, so these are deferred:

- **Automated `db-restore.ts`** — the row-level insert loop above as a guarded
  script (`--dry-run` default, `--table`, refuse-prod-without-`--force-prod`).
- **Nightly off-box copy** — GitHub Action or launchd job running `db-dump.ts`
  and shipping `./backups/<stamp>/` to an R2/S3 bucket (local disk is not a real
  backup). Add `R2_*` creds to `.env.local` / CI secrets first.
