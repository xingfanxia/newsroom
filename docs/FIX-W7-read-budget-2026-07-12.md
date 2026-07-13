# FIX-W7 — read-budget: get steady-state Turso rows_read well under 500M/mo

Follow-on to the 2026-07-12 cluster/Turso audit and the read-quota diagnosis
(`docs/HANDOFF.md` → "Turso read-quota block — DIAGNOSED"). The quota bust this
cycle was a one-off migration-day flood, but prod's clustering read paths
**scan full 3072-dim vectors row-by-row**, so prod re-busts on its own. This
charter lands the durable fix. Branch: `ax/w7-read-budget` (TBD).

## Goal (verifiable)

Steady-state projected monthly `rows_read` **≤ ~150M (30% of the free 500M
cap)**, hard ceiling **250M (50%)**, measured as `7-day run-rate × ~4.3`, with a
standing guardrail that alerts before it creeps back. Clustering quality must
NOT regress (ANN recall backtested against the current exhaustive behavior).

## Read amplifiers → fixes

| # | Amplifier | Fix | Files (expected) |
|---|-----------|-----|------------------|
| **A1** | Stage A / A.5 / merge NN: `vector_distance_cos` over full `embedding` in `ORDER BY … LIMIT` → every window row read; the 256-dim DiskANN `items_embedding_small_idx` is used only by `semantic-search.ts` | Two-stage ANN: `vector_top_k('items_embedding_small_idx', <query embedding_small>, k)` to get k candidates via the index, then rerank those k on the full 3072-dim `embedding` for exact distance + threshold. Template: `lib/search/semantic-search.ts:103`. | `workers/cluster/index.ts`, `workers/cluster/singletons.ts`, `workers/cluster/merge.ts` |
| **A2** | A.5 re-scans the same recent singletons every tick (~144×/72h) | `items.last_recheck_at` cooldown column; skip singletons rechecked within the cooldown window unless a new candidate appeared | `workers/cluster/singletons.ts`, `db/schema.ts`, DDL runner |
| **A3** | arbitrate / canonical-title / commentary scan ~16K clusters/tick | `INDEXED BY` pins + bounded candidate queries (recency/status filters) + `db:optimize` PLAN_CHECKS entries | `workers/cluster/arbitrate.ts`, `canonical-title.ts`, `commentary.ts`, `scripts/ops/db-optimize.ts` |
| **A4** | 48 cron ticks/day, every stage every tick | Stagger/reduce cadence of the expensive stages (reopen, commentary need not run every 30 min) | cron config (`vercel.json` / cron routes) |
| **A5** | Nothing watches usage; `bun test` connects straight to prod | Read-budget monitor (Turso billing API → alert at 60% of cap); staging DB or `hasDb` skip-gate so tests never read prod | `scripts/ops/read-budget.ts` (new), test setup |

## Correctness (ANN is approximate — the real risk)

- Use generous `k` (start 50) + **exact rerank** on the full vector; the
  threshold filter (0.25 join / cohesion gates) runs on the exact distance, so
  a wrong-ordering from ANN can only cost recall, never precision.
- **Backtest**: on real prod data (post-unblock), compare cluster assignments
  produced by the ANN path vs the current exhaustive path over a fixed item
  window; require ≥99% agreement (or characterize the diffs as acceptable).
- **Fallback**: if ANN recall at reasonable k is insufficient, tighten the
  exact-scan recency window instead — still a large read cut, zero recall loss.

## Phases & gates

- **P0 (offline, now):** charter + this doc; read-budget monitor scaffold;
  baseline-measurement harness (EXPLAIN QUERY PLAN runner, ready to fire once
  reads unblock). Gate: scripts typecheck + unit-test on local libSQL.
- **P1 (needs Developer unblock):** measure the true steady-state baseline
  (rows_read/day) + `EXPLAIN QUERY PLAN` on every hot query → record real N.
  Gate: a baseline number written to this doc.
- **P2 (offline-buildable, TDD on local libSQL):** land A1–A3. Gate: behavioral
  tests (ANN parity + waterline + bounded scans), `bun run verify` non-live
  green, PLAN_CHECKS pass.
- **P3 (needs unblock):** deploy, re-measure run-rate, backtest ANN recall,
  iterate to the target. Wire the read-budget monitor + staging gate (A4/A5).
  Gate: 7-day run-rate × 4.3 ≤ 250M (target ≤150M); monitor live.

## Dependency

AX upgrades to Turso **Developer** (immediate read unblock) → enables P1 & P3
measurement/backtest. P0 & P2 build offline and don't wait. NOTE Developer is
single-region — confirm the region tradeoff is acceptable, or plan to move back
to a multi-region tier after the read rate is under control.

## Guardrails (standing)

- Turso is the only data copy — back up before any prod mutation.
- Never `drizzle-kit push`; schema via idempotent PRAGMA-guarded ALTER runners.
- Turso rejects `ANALYZE` → every latency/read-sensitive query needs an
  `INDEXED BY` pin + a PLAN_CHECKS entry (no planner stats exist).
