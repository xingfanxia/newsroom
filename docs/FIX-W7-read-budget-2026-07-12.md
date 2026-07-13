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
- **P2 (this PR — the dominant amplifiers + the guardrail):**
  - **A2 (done)** — A.5 recheck waterline (`items.last_recheck_at`, 12h
    cooldown). ~99M → ~12M/mo. Behavioral tests (cooldown filter, anti-
    starvation ordering, stamp+skip loop, dry-run, recall guarantee).
    **Recall guarantee:** the A.5 *candidate* recency window is
    `neighbor-window + cooldown` (84h), deliberately wider than the ±72h
    neighbor window, so a neighbor arriving in a singleton's final cooldown
    hours still gets ≥1 recheck before the singleton ages out — a plain 72h
    candidate window would drop it permanently (A.5 is the sole late-merge path).
    Stamp writes are busy-retried + chunked (backfill-safe under SQLite's
    variable cap).
  - **A4 (done)** — cluster pipeline 30min → hourly (fetch is hourly). ~2× on
    all stages. Cron-cadence guard test. **Throughput tradeoff (accepted):**
    arbitrate + canonical-title are capped at 15/run, so hourly halves their
    drain rate (15/h vs 30/h) — backlog recovery after downtime is ~2× slower
    and worst-case late-merge latency rises from ≤30min to ≤60min. Fine for a
    personal radar; the per-run caps can be raised later if backlog ever bites
    (at some added LLM cost), independent of this cadence.
  - **A5 (done)** — read-budget monitor (`assessReadBudget` +
    `projectMonthlyReads` + billing script) so the run-rate is watched and the
    remaining-lever decision is measured, not guessed.
  - **A3 (done)** — partial index `clusters(member_count, updated_at) WHERE
    member_count >= 2` accelerates the arbitrate + canonical-title candidate
    scans (identical queries, ~16K-cluster scan → ~1.1K multi-member clusters,
    ~14×). A **partial index, not a recency bound** — the query is unchanged, so
    reopened clusters (verified_at nulled, old latest_member_at) are still found;
    a recency bound would have orphaned them. Verified by a PLAN_CHECKS entry.
  - Projected after A2+A4+A3: **~15M/mo** — well under the <100M target. Gate:
    `bun run verify` non-live green.
- **A1 / A6 — DEFERRED to P3, gated on measurement.** A1 (ANN routing) is
  *approximate*: it can silently drop clustering recall (duplicate events not
  merging), so it must not ship without a recall backtest (≥99% agreement vs the
  exact scan) on the now-unblocked prod DB. After A2+A4+A3 (~15M/mo) its marginal
  cut isn't worth a blind clustering-quality risk. A6 (A.5 outer-query index) is
  a minor scan whose need is only provable from post-deploy EXPLAIN. Build both
  only if the measured run-rate demands it.
- **P3 (needs prod):** ordered, confirm-before-apply:
  1. Back up (`scripts/ops/db-dump.ts`).
  2. **Apply `last_recheck_at` DDL BEFORE the deploy** (`bun run
     db:add-recheck-column`). It is additive + nullable, so the pre-deploy code
     never references it — applying early is backward-compatible. If the code
     deploys first, every cluster tick throws `no such column: last_recheck_at`
     and Stage A.5 silently no-ops (isolated by `safeStage`) until the column
     exists.
  3. Apply the A3 partial index (`bun run db:optimize` — note it also runs a
     `cluster_splits` dedupe DELETE, so honor the back-up-first rule).
  4. Merge/deploy A2+A4+A3.
  5. Measure clean-day delta × 30 (target ≪ 100M); wire the A5 monitor as a
     cron/alert (`PREV_ROWS`/`PREV_AT` for the run-rate projection).
  6. Add A1/A6 iff the measured run-rate demands it.

## Review (P2 adversarial passes — all findings fixed)

`code-reviewer` + `database-reviewer` (empirical, local file-backed libSQL — no
live-DB reads). Every finding fixed before merge:

- **[MEDIUM] Recall gap (code):** the original 72h candidate window could
  permanently miss a neighbor arriving in a singleton's final cooldown hours →
  widened candidate recency to `window + cooldown` (84h); corrected the
  overstated "zero recall loss" docstrings; added the invariant + late-neighbor
  recall tests. See A2 above.
- **[MEDIUM] Monitor silent-ok (code):** `fetchUsage` coerced any API error to
  `rows_read:0` → graded "ok" → now fails LOUD (`res.ok` + `parseUsageTotals`
  throws on missing/NaN `rows_read`); dropped the org-vs-perDB fallback (root of
  the negative-delta noise) → grades `newsroom-v2` directly. `parseUsageTotals`
  unit-tested.
- **[MEDIUM] Deploy-ordering (db):** the DDL was 100% manual + unwired → added
  `db:add-recheck-column` script + the DDL-before-deploy ordering in P3 above.
- **[MEDIUM] Stamp not busy-retried (db):** the set-based waterline stamp was a
  bare write → a SQLITE_BUSY would leave the whole batch unstamped (re-scanned
  next tick, defeating the fix under contention) → now `withBusyRetry`-wrapped.
- **[LOW] Backfill var-limit (db):** the stamp IN-list on the `maxPerRun=null`
  backfill path could exceed SQLite's 32766-variable cap → chunked at 500/UPDATE.
- **[LOW] PLAN_CHECK fidelity (code+db):** the arbitrate/canonical PLAN_CHECKS +
  CI test now mirror the real drizzle queries (LIMIT 15, canonical
  `canonical_title_zh IS NULL` branch) so they can't silently rot. The CI test
  (`tests/cluster/arbitrate-index.test.ts`) EXPLAINs against a seeded local DB —
  the automated coverage the db-reviewer wanted (db:optimize's checks are manual).
- **Confirmed sound (db, empirical):** partial-index selection is *structural* —
  the planner picks `clusters_multimember_idx` with no `INDEXED BY` and no
  ANALYZE, and satisfies the ORDER BY by reverse scan (no TEMP B-TREE). Q3 write-
  amplification (~100–200K index writes/mo) is negligible vs the 25M write cap.

**Deferred (not needed for <100M; recorded as escalation paths):**
- **A6 (supporting index for `last_recheck_at`):** on the live DB the column is
  ALTER-appended (physically after the ~45KB payload), so A.5 reads of it walk
  overflow pages. This is per-row *latency* in the hourly worker only — it does
  NOT increment `rows_read` (Turso bills rows, not overflow pages), and never-
  stamped NULL rows skip the walk. So it doesn't touch the read budget; add the
  index only if A.5 wall-time becomes a problem.
- **A7 (side table `item_recheck(item_id PK, last_recheck_at)`):** stamping an
  8-byte column on the fat row rewrites the whole ~45KB record (150×/tick). Write
  *count* is negligible and byte-churn isn't billed, so not worth it now; it's
  the clean escalation if A.5 stamp volume grows (also removes the A6 walk).

## Guardrails (standing)

- Turso is the only data copy — back up (`scripts/ops/db-dump.ts`) before any
  prod mutation.
- Never `drizzle-kit push`; schema via idempotent PRAGMA-guarded ALTER runners.
- Turso rejects `ANALYZE` → every read-sensitive query needs an `INDEXED BY`
  pin + a PLAN_CHECKS entry (no planner stats exist).
- Prod DDL is confirm-before-apply, NOT autonomous.
