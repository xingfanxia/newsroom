# Newsroom — handoff after cluster-merge fix (2026-04-25, evening session)

> **Read order**:
> 1. This file (cluster-merge fix + cron pipeline change + threshold validation)
> 2. `docs/aggregation/HANDOFF-2026-04-25.md` (morning session — gpt-5.5 + Stage A recall fix)
> 3. `docs/aggregation/HANDOFF-NEXT.md` (previous session — gpt-5.4 era)
> 4. `docs/aggregation/HANDOFF.md` (Wave 1-4 implementation handoff)

---

## Status: PR open, ready for review

Branch: `fix/cluster-merge-prefer-clustered`
Two commits:
- `3890a09` — fix(cluster): prefer-clustered bias + merge backfill
- `5299690` — feat(cluster): wire merge stage into cron pipeline (Stage B+)

Backfill applied to production via the manual CLI before pushing the cron change. After merge to main + deploy, the cron will keep duplicate clusters from re-emerging without operator intervention.

---

## What shipped this session

### The bug

User showed three feed cards for the same Google→Anthropic $40B story, each labeled "2 信源", spanning Bloomberg, FT, TechCrunch AI, Hacker News. Six items, three clusters, every cross-pair distance in [0.05, 0.13] = sim [0.87, 0.95] — well within Stage A's 0.25 / sim 0.75 threshold. They should have been one cluster with 6 members.

### Root cause

Stage A's `assignOneToCluster`:
1. Finds **single nearest neighbor** in ±72h window (any cluster status).
2. If clustered → join. If unclustered → promote to lead of new shared cluster.
3. **Append-only.** Stage B can split, but neither stage can MERGE two existing clusters.

When two near-duplicate items from the same publisher (e.g., two Bloomberg articles about the same launch) arrive in the same batch:
- They're each other's mutual nearest neighbor (same source style + same topic = sim 0.95).
- Both unclustered at the moment of processing.
- Stage A picks the single nearest, takes the "promote unclustered neighbor" branch, forms a NEW cluster.
- An older cluster about the same event from a different publisher (e.g., yesterday's HN cluster at sim 0.94 cross-source) was a candidate too, but ranked second.

Result: parallel clusters that never reconcile. Visible to user as duplicate event cards.

### Fix part 1 — Stage A prefer-clustered bias

`workers/cluster/index.ts:assignOneToCluster()`

Old: single nearest-neighbor query, pick top-1 regardless of cluster status.

New: **two-pass nearest-neighbor lookup**, split by cluster status:
1. Query nearest CLUSTERED item in window. If within threshold → join.
2. Else, query nearest UNCLUSTERED item in window. If within threshold → promote + new cluster.
3. Else → singleton.

Trades best-mate optimality (sometimes pick a slightly farther clustered candidate over a closer unclustered twin) for cross-cluster recall. Documented inline with the Anthropic-Google reference case so future maintainers don't revert thinking it's a regression.

The unclustered query only fires when the clustered query missed — saves one HNSW probe per item in the common case.

### Fix part 2 — Stage B+ merge stage (`workers/cluster/merge.ts`)

A new pipeline stage that runs after Stage B arbitrate, before Stage C canonical-title:

```
A (cluster) → B (arbitrate) → B+ (merge) → C (canonical-title) → D (commentary)
```

For each pair of multi-member clusters in the recency window:
1. Compute MIN, MEAN, and "fraction within 0.25 distance" cosine stats over cross-cluster (a, b) item pairs whose `published_at` values are within 72h of each other.
2. Merge if: `min ≤ 0.25` AND `mean ≤ 0.20` AND `pairs_within / total_pairs ≥ 0.5`.
3. Survivor = older cluster (smaller id). Loser items move; loser cluster row deleted; survivor's verified_at / titled_at / commentary_at nulled so Stages B/C/D regenerate with the larger pool on the next tick.

Time-overlap is computed at **item-level published_at**, NOT cluster.first_seen_at. Critical: a cluster might wrap items from months ago (backfilled OpenAI blog posts), and we must not merge it with another cluster of items from a different period just because both rows happen to have been created today.

No-content cluster filter: skips clusters whose canonical title contains `未披露 / 无法核实 / undisclosed / unable to verify` etc. — these are auto-aggregated empty-link X posts whose embeddings encode "I have no content" rather than a specific event. Merging them would spawn a meaningless mega-cluster.

Union-find handles transitive merges in mean-distance-ASC order so tightest pairs commit first.

The cron stage scopes to `MERGE_RECENCY_HOURS = 6` (clusters with activity in last 6h). Keeps the pairwise-distance compute under ~1s. Manual CLI defaults to 72h, with `--all` for full-history sweeps.

---

## Production state after backfill

Backfill committed before the cron-stage commit (the cron will keep this state from regressing).

| Metric | Before backfill | After backfill |
|---|---|---|
| multi-member clusters | 479 | 471 |
| hot (≥3 members) | 109 | 106 |
| major (≥5 members) | 18 | 20 |
| biggest cluster | 16 | 16 |

Specific user-visible fixes:
- **Cluster 13107** (Google→Anthropic $40B): 2 → **6 members** ✓ user's reported case
- **Cluster 12269** (Apple Tim Cook → Ternus): 5 → **10 members**
- **Cluster 13828** (GPT-5.5 release): 3 → **9 members**
- **Cluster 12753** (Anthropic Claude Design): 5 → **7 members**
- 5 smaller mergers (QbitAI hiring/ranking, etc.)

Stage B re-arbitrated all merged clusters and self-corrected one borderline merge (`19253 → 18780`, dotey GPT-Image-2 prompt template variations) — Stage B's LLM correctly identified them as distinct prompt templates, not the same event, and split back to singletons.

No orphaned items, no member_count drift.

---

## Threshold validation procedure (when embedding model changes)

`MERGE_MIN_DISTANCE = 0.25`, `MERGE_MEAN_DISTANCE = 0.20`, `MERGE_PAIRS_WITHIN_FRACTION = 0.5`, and `MERGE_TIME_OVERLAP_HOURS = 72` are calibrated against `text-embedding-3-large`. They sit at the empirical cliff between same-event and topic-similar:

| Reference cases | mean distance | sim |
|---|---|---|
| QbitAI editor-hiring weekly repeats | 0.05–0.10 | 0.90–0.95 |
| Anthropic-Google $40B (canonical) | 0.091 | 0.91 |
| Same-day GPT-5.5 release coverage | 0.19 | 0.81 |
| **Cliff** | **0.20** | **0.80** |
| Different OpenAI launches (GPT-5 vs GPT-5-Codex vs GPT-5.2) | 0.21–0.26 | 0.74–0.79 |
| Genuinely unrelated topical-similar | 0.30+ | < 0.70 |

If the embedding model is swapped (e.g., text-embedding-4-something), validate with this procedure before relying on the cron stage:

```bash
# 1. Pick 5-10 known same-event cluster pairs and 5-10 known different-event
#    pairs from the cluster_splits audit table (Stage B verdicts).
# 2. Compute pairwise cosine distance for each pair under the new model.
# 3. Adjust MERGE_MEAN_DISTANCE so the cliff sits between the two sets.
# 4. Dry-run scripts/migrations/merge-near-duplicate-clusters.ts --hours 168
#    and eyeball the candidate list for false merges.
# 5. Apply.
```

---

## Operator runbook

```bash
# 0. Sit in the worktree
cd /Users/xingfanxia/projects/portfolio/newsroom-wt-aggregation/

# 1. Inspect a cluster (member titles + sources + timestamps)
bun run scripts/ops/diag-cluster.ts 13107 21485 21521

# 2. Manual merge backfill — wider window than the 6h cron stage
bun run scripts/migrations/merge-near-duplicate-clusters.ts                   # dry-run, last 72h
bun run scripts/migrations/merge-near-duplicate-clusters.ts --apply           # commit, last 72h
bun run scripts/migrations/merge-near-duplicate-clusters.ts --hours 168 --apply
bun run scripts/migrations/merge-near-duplicate-clusters.ts --all             # full history (~30s)

# 3. Drain Stages B/B+/C/D after a manual backfill (or wait for the 30-min cron)
curl -H "Authorization: Bearer $CRON_SECRET" "https://news.ax0x.ai/api/cron/cluster"
```

---

## Files quick-reference

### Modified

```
workers/cluster/index.ts                                Stage A two-pass + prefer-clustered bias
app/api/cron/cluster/route.ts                          Inserts merge stage between arbitrate + canonical-title
tests/cluster/index.test.ts                            +5 assertions for Stage A bias rule
scripts/migrations/merge-near-duplicate-clusters.ts    Refactored to thin wrapper around runMergeBatch
```

### Created

```
workers/cluster/merge.ts                               Stage B+ merge logic (runMergeBatch, mergeClusters)
tests/cluster/merge.test.ts                            22 assertions for merge module + cron wiring
scripts/ops/diag-cluster.ts                            Read-only cluster inspection helper
docs/aggregation/HANDOFF-2026-04-25-cluster-merge.md   This file
```

### Untouched on purpose

- `workers/cluster/arbitrate.ts` — Stage B unchanged. Merge nullifies survivor's verified_at, so Stage B will re-arbitrate on the next tick if needed.
- `workers/cluster/canonical-title.ts` / `commentary.ts` — Stage C/D unchanged. Both already key off titled_at / commentary_at being null, which the merge sets correctly.
- `db/schema.ts` — no schema changes; merge is query-level only.
- `vercel.json` — no new cron route; merge runs inside the existing `/api/cron/cluster` pipeline.

---

## Open follow-ups (non-blocking)

Carried from `HANDOFF-2026-04-25.md`, plus new ones from this session:

- **Vendor-official ↔ media recall** — still open. Sample 20-30 known pairs (OpenAI blog post + TechCrunch coverage) and measure cosine. With the new prefer-clustered bias, vendor↔media singletons should now find their media cluster on Stage A. Re-snapshot multi-member rates after a week of post-deploy traffic.
- **Stage B prompt tuning** — review `cluster_splits` audit for false-split patterns under the new merged-cluster regime. Stage B may need slight tightening if it splits legitimately-merged clusters.
- **Hand-labeled recall list** — template at `docs/reports/backtest-2026-04-24-full/hand-labeled-recall.md`. Operator fills in known-related pairs; companion script reads template and reports merge-or-not under configurable threshold. Now also relevant for tuning MERGE_MEAN_DISTANCE.
- **HNSW ef_search tuning** — left at default 40. Stage A's two-pass query still uses the index for top-1 lookups; if recall on the clustered-only query dips, set `hnsw.ef_search = 100` at session level.
- **Admin UI for cluster ops** — still deferred. Raw SQL + the new `diag-cluster.ts` until 3+ ops/week.
- **Drift-detection cron** — could add a daily cron that runs `merge --all` and alerts if `mergesExecuted > N` (suggests Stage A is leaking duplicates again).

---

## Vercel deploy notes

Branch deploy: `fix/cluster-merge-prefer-clustered` triggers a Vercel preview. Merge to main triggers production deploy.

The new merge stage is opt-OUT only by reverting the import in `app/api/cron/cluster/route.ts`. No env vars to set. No new tables. Schema unchanged.

Latest production deploy: same as morning session (`5c69fbc` / alias `news.ax0x.ai`). After this PR merges, the next cron tick will exercise the merge stage at `recencyHours=6`.

---

## Starting command for next session

```bash
cd /Users/xingfanxia/projects/portfolio/newsroom-wt-aggregation/
git fetch origin && cat docs/aggregation/HANDOFF-2026-04-25-cluster-merge.md
```

Recommended first checks after deploy:
1. Eyeball the next cron's response: `curl -H "Authorization: Bearer $CRON_SECRET" news.ax0x.ai/api/cron/cluster | jq .merge` — expect `mergesExecuted` to be small (most ticks should be 0 once the backfill is steady-state).
2. Run `--hours 24` dry-run after 24h: should show ≤ 2-3 candidates if Stage A's bias is working as intended.
3. Spot-check `cluster_splits` over the next week — any false-split patterns under the larger merged clusters?
