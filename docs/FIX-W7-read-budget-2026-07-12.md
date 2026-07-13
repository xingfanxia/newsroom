# FIX-W7 — read-budget: steady-state Turso rows_read well under 100M/mo

Follow-on to the 2026-07-12 cluster/Turso audit and the read-quota diagnosis
(`docs/HANDOFF.md` → "Turso read-quota block"). Branch: `ax/w7-read-budget`.

## Goal (verifiable, revised 2026-07-12 by AX)

Steady-state projected monthly `rows_read` **< 100M**, and **minimized as far
below that as clustering quality allows** (design target: single-digit M/mo).
Measured as `clean-day delta × 30`. Clustering quality must NOT regress (ANN
recall + cadence windows backtested against current behavior).

## Measured baseline (P1 — 2026-07-12, post Developer unblock)

Region (corrected — earlier "re-homed to us-west-2" claim was wrong; nothing
moved): `newsroom-v2` is in group `default` @ **aws-us-west-2**; app compute is
**sfo1** — co-located US-West (~20ms), correct placement. The `tokyo` group
holds the *unrelated* `exif-photo-blog-ax` blog.

Attribution (Turso usage API, date-windowed):
- Through **2026-07-11**: **2.84M** rows_read cumulative (org-wide) — prod was
  reading ~nothing.
- Through **2026-07-12**: **556.8M** → **~554M read on 2026-07-12 alone**, a
  one-off flood (pg→Turso copy-in + verify, the 95+58 audit agents firing
  health/repair/backtest, recluster-historical, plus these baseline probes).
  **Not steady-state.** `newsroom-v2` alone = 549.8M of it. T0 snapshot for the
  clean-day delta: **rows_read = 566,269,103 @ 2026-07-12**.

Corpus: **21,551** enriched items · **18,392** clustered · **15,220** singleton
clusters · **16,335** total clusters · **~456** items per ±72h window.

Hot-query plans (`EXPLAIN QUERY PLAN`, via `scripts/ops/w7-baseline.ts`):
- **Stage A** clustered/unclustered NN are **already index-bounded** —
  `SEARCH i USING INDEX items_published_at_idx` / `items_cluster_idx`, ~456
  window rows/probe, NOT a full-table scan. (Revises the charter's original A1
  premise: per-probe cost is already small.)
- **A.5** (`singletons.ts`) is capped `MAX_SINGLETON_RECLUSTERS_PER_RUN=150`,
  recency 72h; the *only* dedup is `i.cluster_verified_at IS NULL`. A persistent
  singleton that never finds a neighbour stays NULL and is **re-scanned every
  tick it's in-window (~144×/72h)** → ~150 × ~456 × 48 ticks ≈ **~99M/mo,
  dominant**, mostly redundant.
- Pipeline cadence: `12,42 * * * *` = **48 ticks/day**, all 7 stages every tick.
  **arbitrate + canonical-title take NO recency bound** (pipeline.ts:82,91) →
  candidate scan is not time-bounded.

Unfixed steady-state model: **~110–175M/mo** (A.5 ~99M + Stage A ~4M +
arbitrate/title ~5–23M if unbounded + reopen/merge/commentary small). Already
near the *old* free cap, and the flood proves it re-busts under load.

## Multi-angle fix plan (read cut compounds across levers)

| # | Lever | Mechanism | Cut | Pri |
|---|-------|-----------|-----|-----|
| **A4** | **Cadence split** | Split the monolithic pipeline: **Stage A** stays frequent (hourly — new-item latency); **maintenance** (A.5/reopen/arbitrate/merge/title/commentary) drops to **every 2h**. Safe: maintenance cadence (2h) < smallest window (merge 6h), so every in-window candidate still gets ≥1 pass. | ~4× on all maintenance stages | **HIGH — first, cron-only, zero logic risk** |
| **A2** | **A.5 waterline** | `items.last_recheck_at` cooldown col; skip a singleton rechecked within the window unless a newer candidate appeared since. Kills the ~144× redundant re-scan. | ~100× on A.5 (dominant) | **HIGH** |
| **A3** | **Bound cluster scans** | arbitrate + canonical-title: add a recency filter (`latest_member_at`/`updated_at` within window) + `INDEXED BY` pin + PLAN_CHECKS entry, so they scan recent-unverified, not all 16K. | ~10–16× those stages | **HIGH** |
| **A6** | **Bound A.5 outer candidate query** | ensure the `member_count=1` singleton SELECT is index-assisted (partial index / pin) rather than scanning all 16K clusters for candidates. | avoids 16K/tick candidate scan | MED |
| **A1** | **ANN routing** | `vector_top_k('items_embedding_small_idx', embedding_small, k)` → exact rerank on full 3072-dim `embedding`, for A.5/Stage A/merge/reopen probes. Threshold runs on exact distance ⇒ ANN can only cost recall, never precision. | ~4–9× per probe (compounds w/ A2) | MED |
| **A5** | **Read-budget monitor + staging gate** | `scripts/ops/read-budget.ts` (Turso billing API → alert at 60M/mo); `hasDb`/staging skip so `bun test` never reads prod. | guardrail (prevents regression) | MED |
| **A7** | **De-dup commentary** | `/api/cron/commentary` (10,40) may overlap the in-pipeline Stage D commentary — verify; drop the redundant one. | removes a redundant stage | LOW |

Projected fixed steady-state: **< 10M/mo** (A4 ~4× × A2 ~100× on the dominant
term). Comfortably beats the <100M target with large margin.

## Correctness (ANN + cadence are the real risks)

- ANN: generous `k` + **exact rerank**; backtest ANN vs exhaustive cluster
  assignment over a fixed window, require ≥99% agreement.
- Cadence: maintenance every 2h < merge 6h / A.5 72h windows ⇒ no candidate is
  missed; only latency-to-first-maintenance rises (acceptable for a radar).
- Waterline: cooldown must reset when a *new* in-window candidate appears, else a
  late-arriving duplicate is never merged. Test both branches.

## Phases & gates

- **P0 (done):** charter + `scripts/ops/w7-baseline.ts` (EXPLAIN + corpus +
  billing snapshot).
- **P1 (done):** measured baseline above (corpus, plans, cadence, attribution).
- **P2 (offline TDD on local libSQL):** land A4, A2, A3, A6, A1. Gate: behavioral
  tests (waterline both branches, bounded scans, ANN parity, cadence split),
  `bun run verify` non-live green, PLAN_CHECKS pass.
- **P3 (needs prod):** apply `last_recheck_at` DDL (confirm-before-apply; back up
  first); deploy; clean-day delta × 30 < 100M (target < 10M); ANN recall
  backtest; wire read-budget monitor + staging gate (A5).

## Guardrails (standing)

- Turso is the only data copy — back up (`scripts/ops/db-dump.ts`) before any
  prod mutation.
- Never `drizzle-kit push`; schema via idempotent PRAGMA-guarded ALTER runners.
- Turso rejects `ANALYZE` → every read-sensitive query needs an `INDEXED BY`
  pin + a PLAN_CHECKS entry (no planner stats exist).
- Prod DDL is confirm-before-apply, NOT autonomous.
