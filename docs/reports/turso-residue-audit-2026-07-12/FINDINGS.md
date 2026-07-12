# Turso-switch residue audit — hidden unresolved issues (2026-07-12)

Site-wide review for issues left behind by the Postgres→Turso migration
(PR #38/#39/#40) that didn't break loudly at cutover. Method: 6 audit
dimensions (opus) × adversarial 2-lens verification per finding (sonnet),
58 agents total, read-only against prod. CONFIRMED = survived both
verifiers; PLAUSIBLE = one verifier dissented (usually on impact size,
not correctness).

**Overall verdict: the migration is unusually disciplined.** The verifiers
explicitly cleared most classic pg→SQLite trap classes (aggregate return
types, boolean 0/1 decoding, JSON-text boundaries, UTC date bucketing,
FILTER/NULLS LAST support, atomic claim UPDATEs, no FOR UPDATE leftovers).
What remains is concentrated in four themes: **destructive-tooling guards,
backup/observability, unbounded queries, and lock-contention handling.**

## P0 — fix before anything else

| # | finding | location | fix |
|---|---|---|---|
| 1 | **`db:push` hardcodes `--force`** — running it auto-applies drizzle's known false-diff, which DROPS `items.embedding` + the DiskANN index. One habitual command = unrecoverable data loss (see #2). CONFIRMED/critical | `package.json:18` | Remove the script (or make it exit 1 with a pointer to the raw-DDL procedure). The guard must live in the command, not in HANDOFF prose. |
| 2 | **No backup of the only data copy** — Supabase deleted; Turso Starter plan, `delete_protection` OFF, single region, zero dump automation. PLAUSIBLE/critical (plausible only because Turso-side PITR state couldn't be fully introspected) | `db/client.ts:37` | (a) enable delete-protection via platform API; (b) nightly dump → R2 (GitHub Action or cron script streaming all tables gzipped); (c) document restore procedure. |

## HIGH

| finding | location | fix sketch |
|---|---|---|
| Admin usage dashboard: 39s full scan of 364k `llm_usage` rows per load (`strftime` on `created_at`, no range predicate). CONFIRMED | `lib/llm/stats.ts:193` | Bound to a lookback window (index-prunable `created_at >=` bound) + integer-day bucketing instead of strftime-equality; add PLAN_CHECKS entry. |
| Semantic-search brute-force fallback: if the ANN index is missing/unusable, public search silently runs an unbounded 21.5k-row × 12KB embedding scan (~37s). Two dimensions found it independently. CONFIRMED | `lib/items/semantic-search.ts:148` | Bound the fallback (recency window / hard candidate cap), log loudly, or fail closed (503) for anonymous callers. No statement_timeout exists on libSQL — the app must self-bound. |
| No safe path for the NEXT schema change — `db/migrations` absent, `db:generate`/`db:migrate` incoherent with the raw-DDL-built DB, drizzle-kit unsafe. CONFIRMED | `package.json:12` | Adopt ordered raw-SQL ops scripts + `schema_migrations` ledger as the documented procedure; neuter the misleading drizzle-kit scripts. |
| No SQLITE_BUSY handling anywhere — interactive transactions hold the single global write lock; concurrent user write + cron write = unhandled 500 (pg queued on row locks instead). PLAUSIBLE/high | `db/client.ts:37` | busy-timeout PRAGMA at init + bounded jittered retry on SQLITE_BUSY around transactions; keep interactive txns short. |

## MEDIUM

| finding | location | fix sketch |
|---|---|---|
| MCP feed/search date params skip the HTTP path's validation → `Date.parse` NaN reaches the driver (crash or wrong-day results). CONFIRMED | `lib/api/feed-query-params.ts:167` | Same strict date schema as HTTP; NaN-guard before binding. |
| Admin usage "all" window: 12.8s + 4.1s unbounded GROUP-BY scans. CONFIRMED | `lib/llm/stats.ts:84` | Covering index on (task, provider, model, aggregates) or per-day rollups; stopgap: bounded lookback. |
| `docs/architecture/ingestion.md` §2.7 still documents halfvec/jsonb Postgres schema as current. CONFIRMED | `ingestion.md:224` | Rewrite schema block (F32_BLOB, embedding_small, TEXT JSON). |
| merge.ts `AND NOT noContentSkip` three-valued-logic: untitled clusters silently excluded from merge candidates (pipeline runs merge before Stage C titles). PLAUSIBLE — self-heals next tick once titled; window is one tick in the common case | `workers/cluster/merge.ts:156` | `AND COALESCE(NOT (…), 1)` — mirror canonical-title.ts's explicit NULL guard. |
| `applySplitVerdict` holds the global write lock across O(N) network round-trips (2 statements per rejected member in one interactive txn). PLAUSIBLE | `workers/cluster/arbitrate.ts:311` | Collapse to 3 set-based statements (bulk UPDATE…IN…RETURNING + bulk INSERT + one decrement). |
| Cluster-worker NN scans un-pinned (~350 fat-blob scans/tick on stat-less planner). PLAUSIBLE | `workers/cluster/index.ts:146` | INDEXED BY pins + PLAN_CHECKS; long-term: route through `items_embedding_small_idx` (vector_top_k) like semantic search. |
| No busy_timeout on user-facing feedback toggle txn. PLAUSIBLE | `lib/feedback/toggle.ts:61` | Retry-on-BUSY or collapse to single statement. |
| `check-data-state` source test green-lights on stale pg SQL surviving only in comments. PLAUSIBLE | `tests/ops/check-data-state-source.test.ts:18` | Re-assert against the SQLite implementation (`Date.UTC(`, `strftime('%Y-%m'`). |
| No DB-level observability (Supabase slow-query/latency views gone, nothing replaced them). PLAUSIBLE | `vercel.json:3` | Timed-canary health cron + threshold alert; optional Turso platform-API size polling. |

## LOW

- Stale "Neon HTTP driver doesn't support transactions" comment justifies a
  non-atomic insert-item→mark-normalized pair on a false premise —
  `workers/normalizer/index.ts:24`. Fix comment; optionally wrap in txn.
- Merge candidate query builds an automatic temp index + O(clusters²)
  fat-embedding cross-join — bounded in cron (6h), unbounded via ops `--all`
  path — `workers/cluster/merge.ts:164`. Require a window even in `--all`.
- ILIKE→LIKE dropped non-ASCII case-folding (accented Latin/Cyrillic/Greek;
  Chinese unaffected — no case) in lexical search — `lib/items/live.ts:187`.
  Fold in JS before binding, or document the limitation.
- Batch-size comment still cites pg's parameter limit — `lib/backfill/runner.ts:130`.
- `tests/api/public-feed.test.ts:9` hard-throws without `--env-file` instead
  of the documented `hasDb` skip convention (this is the known standalone-run
  trap from the TURSO-1 session).
- Plaintext dead-Supabase secret dump still in the working tree
  (`.env.local.bak-supabase-purge`) — delete it; the project is gone but
  plaintext secret files shouldn't linger.

## Verified SAFE (do not re-investigate)

- Aggregates return JS `number` under default intMode (probed live); all read
  sites either `Number()`-wrap or use typed drizzle selects.
- Boolean/timestamp/JSON raw-wire shapes handled honestly at every
  `client.all` site swept (newsletter select, legacy feeds, system-stats,
  llm stats); writes all go through drizzle mappers.
- UTC day-bucketing matches old pg behavior (Supabase default TZ was UTC);
  no `%W` week-numbering usage; `/1000.0` float division safe.
- `json_each`/`json_extract` replacements correct across live.ts,
  dashboard-stats, saved.ts; CAST-AS-REAL guards where division matters.
- Cluster/enrich claim predicates are single atomic UPDATEs; merge/arbitrate
  loops run sequentially so cluster txns don't self-contend;
  `singletons.ts` correctly uses `behavior:'immediate'`.
- No ILIKE/FOR UPDATE/advisory-lock leftovers in code.

## Refuted (for the record)

- `commitSkillVersion` deferred-txn race (`lib/policy/skill.ts:124`) — real
  shape, but verifiers established the write path is effectively
  single-writer (admin-only) and the deferred read-then-write cannot
  interleave harmfully at this deployment's concurrency.
- "Dead `db:hnsw` command referenced in HANDOFF" — the reference is
  historical narrative, not current procedure.

Full machine-readable findings (evidence + verifier reasoning per item):
this session's audit ran as workflow `wf_889559c6-11b`; summary JSON was
extracted to the session scratchpad. Empirical probes used are under
`tmp/audit/` (gitignored).
