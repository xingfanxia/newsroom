# AX's AI RADAR — Event aggregation handoff (Waves 1-4 implemented, 2026-04-24)

> **Read order**:
> 1. This file (operational status + runbook)
> 2. `docs/aggregation/DESIGN.md` (architecture, decisions, contracts) — committed `a2a7a93`
> 3. `docs/aggregation/PLAN.md` (per-wave task breakdown) — committed `bba8707`
> 4. `docs/HANDOFF-AGGREGATION.md` (the original design seed — kept for context)

---

## Status: ready for backtest + deploy

Implementation Waves 1-4 are committed on **`feat/event-aggregation`** at the worktree
`/Users/xingfanxia/projects/portfolio/newsroom-wt-aggregation/`. 14 commits ahead of `main`. Backend, workers, read path, and UI are all in. **No production state has been touched yet** — schema not pushed, migration not run, feature flag not flipped, PR not opened.

The reversibility property holds: every commit on `feat/event-aggregation` can be `git revert`-ed cleanly without touching prod state.

---

## What shipped (Waves 1-4)

### Wave 1 — Schema + foundation (2 commits)

| SHA | What |
|---|---|
| `919a88a` | `db/schema.ts`: extended `clusters` with event-level fields (`canonical_title_{zh,en}`, `summary_{zh,en}`, `editor_note_{zh,en}`, `editor_analysis_{zh,en}`, `commentary_at`, `importance`, `event_tier`, `hkr`, `coverage`, `latest_member_at`, `verified_at`, `titled_at`); added `cluster_verified_at` + partial index to `items`; new `cluster_splits` audit table; exported `events`/`Event`/`NewEvent` aliases over `clusters` for semantic clarity. **All additive** — `ALTER TABLE clusters DROP COLUMN …` reverses cleanly. |
| `f0fc428` | `workers/cluster/importance.ts` + 10 unit tests: `recomputeEventImportance` (base + `log2(1+coverage)*6`, capped 100), `approximateTierForImportance` (transient bucket; not a substitute for the LLM scorer's HKR-gated rubric), `unionHkr`. |

### Wave 2 — Workers (4 parallel subagent worktrees, merged + cleaned)

Dispatched 4 Sonnet subagents in parallel worktrees, each implementing one Stage. Merged back through 4 merge commits + manual `prompt.ts` concatenation conflict resolution.

| SHA | What |
|---|---|
| `f71aaff` | **Stage A tune** (`workers/cluster/index.ts`): threshold 0.88 → 0.80, window 48h → 72h, anchor `now()` → target item's `published_at` (bidirectional ±, fixes backfill case), skip `cluster_verified_at IS NOT NULL` candidates, maintain `latest_member_at` + `coverage` on every member join. |
| `6deff6b` | **Stage B arbitrator** (`workers/cluster/arbitrate.ts` + `prompt.ts` initial + `lib/llm/types.ts` LLMTask `arbitrate`): Haiku decides keep-or-split; on split, unlinks rejected members + writes `cluster_splits` row + decrements `member_count`; on keep, sets `verified_at` + `cluster_verified_at` to lock against future Stage A reshuffling. Budget `MAX_ARBITRATIONS_PER_RUN = 15`. 12 unit tests on prompt shape + verdict logic. |
| `c7e641a` | **Stage C canonical title** (`workers/cluster/canonical-title.ts`): Haiku generates neutral 8-14 word titles (zh + en) for `member_count >= 2`. Skips singletons. Regen on `updated_at > titled_at`. 17 unit tests. |
| `3949f2d` | **Stage D event commentary** (`workers/cluster/commentary.ts` + enrich-side skip in `workers/enrich/commentary.ts`): event-level editor-note + editor-analysis for featured/p1 multi-member clusters. Replicates per-item editorial voice (style guardrails copied verbatim from `workers/enrich/prompt.ts`). Singletons keep per-item commentary unchanged. 31 unit tests. |
| `c748dda`, `7e52c8e` | Merge resolutions for `prompt.ts` 3-way add/add (concatenated). |
| `6aed445` | Test normalization: vitest → bun:test imports + `import.meta.dir` → `fileURLToPath(import.meta.url)`. |
| `2d23c6e` | LLMTask extension: `canonical-title` + `event-commentary` (so /admin cost dashboards distinguish per-stage spend). |

### Wave 3 — Read path (1 commit)

| SHA | What |
|---|---|
| `e91d87a` | `lib/items/live.ts`: FeedQuery gains `view: 'today' \| 'archive'` + `hotWindowHours`. `buildFeedWhere` uses `COALESCE(cluster.event_tier, items.tier)` + `COALESCE(cluster.first_seen_at, items.published_at)` so singletons render unchanged. Today view filter: `firstSeenAt today OR latestMemberAt within hot window OR unclustered item from today`. View-aware `ORDER BY` (`latestMemberAt DESC` for today, `firstSeenAt DESC` for archive). Mapper uses COALESCE at every editorial field. New `getEventMembers(clusterId, locale)` helper. New public route `app/api/events/[id]/members/route.ts` for the signal drawer. `lib/items/semantic-search.ts` gains cluster-aware dedup + event-tier-aware exclusion. `lib/types.ts` Story extensions: `clusterId`, `coverage`, `firstSeenAt`, `latestMemberAt`, `canonicalTitleZh/En`, `stillDeveloping`, `members`. |

### Wave 4 — UI (1 commit, inline not parallel)

| SHA | What |
|---|---|
| `a8da2d1` | `components/feed/event-badge.tsx`, `coverage-chip.tsx`, `signal-drawer.tsx` (new). Integration in `components/feed/item.tsx`. Home page `app/[locale]/page.tsx` switches to `view: 'today'` when no day-picker date. Styles appended to `app/terminal.css` matching tier-pill aesthetic + signal-drawer like `.i-expand`. **i18n note**: project uses inline `showZh ? "中文" : "english"` ternaries via `useTweaks`, not next-intl — so no `messages/*.json` additions (plan deviation, logged below). |

### Test status

```
86 pass / 0 fail across 5 files (workers/cluster/* + tests/cluster/index.test.ts)
```

All cluster-stage tests are **pure unit** (prompt shape, candidate-filter predicates, importance formula, schema validation). Integration testing against a real DB is deferred to Wave 6 E2E + post-deploy live observation. The `bun:test`-not-found TSC errors mirror pre-existing codebase state — not regressions.

---

## What's left

### Wave 5 — Migration + backtest + deploy (operator-driven)

| Step | What | Touches prod? |
|---|---|---|
| **5.1** | Write `scripts/ops/backtest-cluster.ts` per DESIGN.md §10 — shadow-table replay, diff reports, hand-labeled recall, optional Stage B exercise. ~300 LOC. | No |
| **5.2** | **OPERATOR GATE.** Run backtest with `--threshold 0.80 --window 72`. Eyeball spot-check sample (30 random merged clusters), verify ≥16/20 known-related pairs merged. If fail → tune threshold to 0.82 or augment embedding input with `summaryEn`. | No |
| **5.3** | Apply schema: `bunx drizzle-kit push` then **`bun run db:hnsw` (mandatory — drizzle-kit push drops the HNSW index every time per `docs/HANDOFF-AGGREGATION.md` operational note)**. Run migration script per DESIGN.md §9 (backfill `latest_member_at` + copy lead-item commentary → cluster + null multi-member `commentary_at` + recompute importance). | **Yes — schema + data** |
| **5.4** | `vercel env add ENABLE_EVENT_AGGREGATION true production && vercel --prod`. Vercel bakes env at deploy time per [Vercel CRON_SECRET memory](memory/feedback_cron_secret_gotcha.md), so redeploy is required. | **Yes — env + deploy** |

### Wave 6 — Verification + PR (mostly tooling)

- E2E Playwright tests for home Today view + STILL DEVELOPING badge + signal drawer
- Visual sweep — screenshots vs terminal aesthetic baseline
- `feature-dev:code-reviewer` agent on the full 14-commit diff
- `think-ultra` review on milestone diff
- Open PR `feat/event-aggregation` → `main`

---

## Operator runbook

```bash
# 0. Sit in the worktree (where all the work is)
cd /Users/xingfanxia/projects/portfolio/newsroom-wt-aggregation/

# 1. Confirm state
git log --oneline main..HEAD          # 14 commits
git diff main..HEAD --stat            # +~3000 / -~50 LOC
bun test workers/cluster/ tests/cluster/   # 86/86 green

# 2. Local smoke before any prod write — boot dev server, eyeball home
bun run dev
# → http://localhost:3009 should render with view='today'
# → if any feed query throws, the issue is likely a missing schema column —
#   that's expected because Wave 1 schema changes haven't been pushed to the
#   DB yet. Skip to step 3 first.

# 3. Push schema (additive, reversible). MUST follow with HNSW restore.
bunx drizzle-kit push
bun run db:hnsw

# 4. Backfill — write or hand-port the migration per DESIGN.md §9.
#    The minimal sequence (idempotent — safe to re-run):
psql $DATABASE_URL <<'SQL'
-- Backfill latest_member_at from MAX(member.published_at)
UPDATE clusters c SET latest_member_at = sub.max_pub
FROM (SELECT cluster_id, MAX(published_at) AS max_pub FROM items
      WHERE cluster_id IS NOT NULL GROUP BY cluster_id) sub
WHERE c.id = sub.cluster_id AND c.latest_member_at IS NULL;

-- Backfill first_seen_at as MIN(published_at) where unset
UPDATE clusters c SET first_seen_at = sub.min_pub
FROM (SELECT cluster_id, MIN(published_at) AS min_pub FROM items
      WHERE cluster_id IS NOT NULL GROUP BY cluster_id) sub
WHERE c.id = sub.cluster_id AND c.first_seen_at IS NULL;

-- Copy lead-item editorial fields → cluster
UPDATE clusters c SET
  editor_note_zh = i.editor_note_zh,
  editor_note_en = i.editor_note_en,
  editor_analysis_zh = i.editor_analysis_zh,
  editor_analysis_en = i.editor_analysis_en,
  commentary_at = i.commentary_at,
  hkr = i.hkr,
  importance = i.importance,
  event_tier = i.tier,
  coverage = c.member_count
FROM items i WHERE i.id = c.lead_item_id;

-- Multi-member clusters: null commentary_at so Stage D regenerates with
-- cross-source context
UPDATE clusters SET commentary_at = NULL WHERE member_count >= 2;
SQL

# 5. Restart dev server, eyeball home + click coverage chip → drawer should
#    populate with members. /all?date=YYYY-MM-DD should still show events
#    on their first-seen day.

# 6. Run backtest if you write it (optional pre-ship gate, per DESIGN.md §10)

# 7. Deploy
vercel env add ENABLE_EVENT_AGGREGATION true production
vercel --prod

# 8. Open PR
gh pr create --base main --head feat/event-aggregation \
  --title "feat: cross-source event aggregation (Waves 1-4)" \
  --body-file <(cat <<'EOF'
## Summary
Promotes clusters to first-class editorial events. Coverage-boosted importance,
LLM-arbitrated membership, canonical titles, event-level commentary, two reader
views (Today trending + Archive), signal drawer surfacing cross-source coverage.

## Phases shipped
- Wave 1: schema + importance pure function
- Wave 2: 4 parallel workers (Stage A tune, Stage B arbitrate, Stage C canonical
  title, Stage D event commentary)
- Wave 3: read-path rewrite with COALESCE fallback (singletons unchanged)
- Wave 4: UI badges + coverage chip + signal drawer + Today view wiring

## Tests
86/86 cluster unit tests pass. Pre-existing `bun:test` TSC noise unchanged.

## Risks / follow-ups
- Stage B prompt may need tuning based on `cluster_splits` audit week 1
- Re-embedding with `summaryEn` augmentation is the recall fallback if
  hand-labeled pairs miss
- Admin UI for manual merges deferred (raw SQL until needed)

@claude please review.
EOF
)
```

---

## Autonomous decisions made (logged for review)

1. **Big-bang scope, backtest as ship gate** (vs phased rollout) — per user pushback during brainstorming: existing 2900 embeddings make offline backtest superior to "ship and observe."
2. **Extend `clusters` table in place** (vs rename to `events` or new table) — preserves `items.cluster_id` FK and every row reference; rollback = `DROP COLUMN` only.
3. **Skip per-member roles** (`primary` / `corroborating`) — YAGNI; lead item + `ORDER BY importance DESC, published_at ASC` produces same surface.
4. **Stage B inline with cluster cron, cap 15/run** — clustering already runs ~5min cron, no second cron needed.
5. **Cold-start migration: copy lead-item commentary, null multi-member `commentary_at`** — preserves singletons' sunk LLM spend; multi-member clusters regen with cross-source context.
6. **Stage A vs Stage B disagreement: trust B + verify-lock** — `verified_at` on cluster + `cluster_verified_at` on items prevents Stage A re-merging what B split.
7. **Clustering window: rolling ±72h anchored to target item's `published_at`** (vs `now()`-anchored 48h) — fixes the backfill bug where late-arriving items couldn't find their temporal cohort.
8. **Embedding input unchanged** (`title + summaryZh`) — re-embed with `+summaryEn` is the recall fallback if backtest fails; body inclusion is last resort.
9. **Two views: Today (latestMemberAt anchor) + Archive (firstSeenAt anchor)** — vs single hybrid score; explicit views match reader intent (trending vs historical).
10. **Wave 1 inline (not subagent)** — mechanical schema + pure fn, subagent overhead not justified.
11. **Wave 2 parallel × 4 worktrees** — genuinely disjoint work, big wall-time win. Sonnet model. Merge conflict on `prompt.ts` was the only coordination cost (resolved by concatenation).
12. **Wave 3 inline serial** — read-path is shared-file refactor.
13. **Wave 4 inline (not parallel × 3 worktrees as plan said)** — 3 components all compose into the single `item.tsx`, serial was simpler than merging 3 worktrees with a shared integration point.
14. **Inline `showZh` i18n** (vs next-intl `useTranslations`) — matched existing codebase convention; dropped planned `messages/*.json` additions.
15. **Stopped at Wave 4→5 boundary** — Waves 1-4 are reversible (revertable commits, no prod state); Waves 5-6 require irreversible operations (DB push, env mutation, deploy, PR merge).

---

## Known follow-ups (deferred, not blocking)

- **Integration tests against real DB** — all Wave 2 worker tests are pure-unit. Wave 6 E2E + first-week prod observability fills this gap.
- **Stage B prompt tuning** — review `cluster_splits` audit table after week 1; tune system prompt based on false-split patterns.
- **Admin UI for manual merge/split** — non-goal; raw SQL until 3+ operator interventions per week.
- **Canonical title regeneration trigger** — currently uses `updated_at > titled_at` as proxy. Exact "+2 members since titled_at" precision is a polish follow-up.
- **Re-embedding with `summaryEn` augmentation** — fallback path if backtest recall misses cross-language pairs.
- **Stage B reasonableness floor** — if it ever returns `split` with the entire cluster as `rejectedMemberIds`, that's a no-op edge case to handle (just skip the operation).
- **Event permalink page `/event/:id`** — non-goal in this phase; signal drawer on cards is sufficient for v1.

---

## Operational notes (do NOT skip)

1. **HNSW index drop** — `drizzle-kit push` drops `items_embedding_hnsw_idx` every time because drizzle doesn't model it. **Always run `bun run db:hnsw` after `bunx drizzle-kit push`.** This was documented in the original `docs/HANDOFF-AGGREGATION.md`; re-stating because the migration in step 4 above relies on the index existing.
2. **Vercel env baking** — `vercel env add` doesn't propagate to running deployments. Must redeploy with `vercel --prod` for `ENABLE_EVENT_AGGREGATION=true` to take effect.
3. **Feature flag** — currently the code does NOT actually check `ENABLE_EVENT_AGGREGATION`. The flag was a *planned* rollback safety net; the read path's `COALESCE(cluster.X, items.X)` fallback already provides this property at the SQL level (singletons unchanged, multi-member events use cluster fields). If you want explicit kill-switch behavior, gate `view: 'today'` defaulting in `app/[locale]/page.tsx` on the env var, and gate the cluster-stage cron workers in `app/api/cron/cluster/route.ts`. Adding the flag to the cron is a 5-line change in Wave 5 if you want belt-and-suspenders.
4. **Worker wiring into cron** — Wave 2 created the worker modules but the plan's Task 2.M Step 5 (wire `runArbitrationBatch` / `runCanonicalTitleBatch` / `runEventCommentaryBatch` into the cluster cron after `runClusterBatch` completes) **was not done in this session.** The cron handler at `app/api/cron/cluster/route.ts` still only calls `runClusterBatch`. Add the chain:
   ```ts
   import { runArbitrationBatch } from "@/workers/cluster/arbitrate";
   import { runCanonicalTitleBatch } from "@/workers/cluster/canonical-title";
   import { runEventCommentaryBatch } from "@/workers/cluster/commentary";
   // after runClusterBatch():
   const arb = await runArbitrationBatch();
   const titles = await runCanonicalTitleBatch();
   const comm = await runEventCommentaryBatch();
   // include in cron response payload
   ```
   This is the **most important runtime gap**; without it, Stage B/C/D never fire.
5. **Worker DB readiness** — the cluster workers import `@/db/client` at module load. The cron wiring above will fail at module-resolve time unless the schema matches. Push schema (step 3) before wiring or before any cron tick post-deploy.

---

## Files quick-reference

### Created

```
db/schema.ts                                 (modified — 4 schema additions)
workers/cluster/importance.ts                (NEW pure-fn module + 10 tests)
workers/cluster/arbitrate.ts                 (NEW Stage B + 12 tests)
workers/cluster/canonical-title.ts           (NEW Stage C + 17 tests)
workers/cluster/commentary.ts                (NEW Stage D + 31 tests)
workers/cluster/prompt.ts                    (NEW — combined B/C/D prompts)
workers/enrich/commentary.ts                 (modified — multi-member skip)
lib/items/live.ts                            (modified — two views + COALESCE + getEventMembers)
lib/items/semantic-search.ts                 (modified — cluster-aware dedup)
lib/types.ts                                 (modified — Story extensions)
lib/llm/types.ts                             (modified — LLMTask additions)
app/api/events/[id]/members/route.ts         (NEW — signal drawer endpoint)
app/[locale]/page.tsx                        (modified — view='today' on home)
components/feed/event-badge.tsx              (NEW)
components/feed/coverage-chip.tsx            (NEW)
components/feed/signal-drawer.tsx            (NEW)
components/feed/item.tsx                     (modified — integrate badges + chip + drawer)
app/terminal.css                             (modified — +79 lines styles)
docs/aggregation/DESIGN.md                   (NEW spec, committed a2a7a93)
docs/aggregation/PLAN.md                     (NEW plan, committed bba8707)
docs/aggregation/HANDOFF.md                  (this file)
tests/cluster/index.test.ts                  (NEW Stage A tuning tests)
```

### Untouched (deliberate non-goals)

- `app/api/cron/cluster/route.ts` — needs Wave 5.x wiring per Operational note 4
- `scripts/migrate/events-from-clusters.ts` — Wave 5.3 deliverable, not started
- `scripts/ops/backtest-cluster.ts` — Wave 5.1 deliverable, not started
- `messages/zh.json` / `messages/en.json` — i18n approach changed (inline ternaries); deleted from plan
- Admin UI for cluster operations — explicit non-goal

---

## Starting command for next session

```
cd /Users/xingfanxia/projects/portfolio/newsroom-wt-aggregation/
# Decide: ship Waves 1-4 as-is + tackle 5+6 manually, OR write 5.1 backtest harness first

# Recommended sequence:
# 1. Wire Stage B/C/D into cron (Operational note 4 — 5-line change)
# 2. Push schema + restore HNSW + apply migration SQL
# 3. Boot dev server, eyeball home Today view + signal drawer locally
# 4. Optionally write + run backtest script for pre-prod confidence
# 5. Deploy + flip env flag
# 6. Open PR
```

If you'd rather hand the whole remaining sequence to a fresh autonomous run:

```
/big-task event-aggregation Wave 5 + 6 — wire workers into cron, write migration script
+ backtest harness, run backtest, apply migration, redeploy, open PR. Reference branch
feat/event-aggregation; runbook in docs/aggregation/HANDOFF.md.
```
