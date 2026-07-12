# NEWSROOM-CLUSTER-1 — empirical data appendix (2026-07-12)

All measurements taken read-only against prod Turso `newsroom-v2` on
2026-07-12 (UTC). Reproduce with `bun --env-file=.env.local
scripts/ops/cluster-health.ts --days 14`.

## Cluster population

| bucket | clusters | items |
|---|---|---|
| 1 (singleton) | 15,217 | 15,217 |
| 2 | 765 | 1,530 |
| 3-5 | 282 | 995 |
| 6-10 | 47 | 346 |
| 11+ | 17 | 290 |

Singleton rate 93.2% (15,217 / 16,328). Per source group (singleton share of
clustered items): product 96%, vendor-official 89%, social 86%, research 86%,
podcast 84%, policy 84%, media 81%, newsletter 72%.

## Integrity counters

| invariant | violations |
|---|---|
| `member_count` ≠ actual COUNT(items) | 6 clusters (48982 mc=1 actual=3, 48997 mc=1 actual=2, 48959 mc=1 actual=2, 48949 mc=10 actual=11, 48878 mc=4 actual=5, 49009 mc=1 actual=0). **Root-caused: pg→Turso cutover artifact, NOT a runtime bug** — the copy captured `clusters` before `items` while the Supabase pipeline was still ticking, and the id-keyed delta-topup never re-copied UPDATEs to already-copied rows; `clusters` aggregates have no self-heal path. 3 of the 6 (48959/48982/48997) are stuck at mc=1 → permanently excluded from arbitrate/titles/importance. Full forensic + repair SQL in FINDINGS.md. |
| `coverage` ≠ `member_count` | 104 clusters |
| zombie clusters (member_count=0) | 0 |
| dangling `lead_item_id` (lead not a member) | 11 clusters — all `member_count=1` split-remnants |
| verified singletons (locked out of Stage A.5) | 90 |

Feed impact of dangling leads: the feed dedup predicate
(`lib/items/live.ts:129` — `cluster_id IS NULL OR clusters.lead_item_id =
items.id`) renders NOTHING for these clusters. 10 items currently hidden;
8 are `excluded`-tier (hidden anyway), 1 `all`, 1 `excluded` — minimal current
user damage, structural risk high (a split of a lead on a featured event would
silently hide the event).

## cluster_splits (Stage B rejections)

- 58,190 rows over only 304 distinct items; 57,833 rows concentrated in 233
  (item, from_cluster) pairs with >5 repeats; worst pair repeated **2,174×**.
- Daily volume: hundreds/day before 2026-06-12; 1-40/day after
  (fix `214859b` added the Stage A/A.5 `NOT EXISTS cluster_splits` guard +
  distinct-cluster cap). The cap counts DISTINCT clusters, so same-cluster
  repeat loops (the dominant pattern) never advance it — the loop died because
  Stage A stopped re-joining, not because the cap fired.
- Loop-item sources: r/LocalLLaMA 122 of 304 (near-identical "run Qwen on
  RTX 3090" posts), Bloomberg 29, X accounts, digests.

### LLM cost of the loop (from `llm_usage`)

| task | calls all-time | cost |
|---|---|---|
| arbitrate | 34,893 | $62.93 |
| canonical-title | 21,159 | $29.49 |
| event-commentary | 4,928 | $43.12 |

Arbitrate by week: ~5,030 calls/week for weeks 2026-18..23 (= 15-cluster cap ×
48 ticks/day saturated for ~6 weeks) → 68-172 calls/week post-fix. ≈$100 of
the ≈$135 all-time cluster-stage spend was loop churn. 21k title calls for
~1.1k multi clusters ≈ 19 re-titles per cluster. Side effect: the 15/tick
arbitrate cap was saturated by looping clusters for weeks → legit clusters
starved.

## Recall gaps

- Near-duplicate multi-member cluster pairs still unmerged (14d, corrected
  NULL-safe predicate): **0** — the merge stage keeps up for multi↔multi.
- Same-event singleton pairs >72h apart (14d, d≤0.20): 10 pairs / 8 items.
  True misses include Dan Luu notes (d=0.094, gap 111h), NotebookLM launch
  (d=0.170, gap 166h). Correct-keeps also present (Claude Code v2.1.198 vs
  .202 vs .206 are different events at d≈0.15) — a blanket window widening
  would over-merge; the gap needs an arbitrated path, not a bigger window.
- Singleton pairs WITHIN 72h at d≤0.25 (14d): 8 — but snapshot-sensitive; the
  Grok Build trio and Mesh LLM pair from this list converged into clusters
  48982/48997 within a few ticks of the snapshot. Within-window convergence
  machinery works; the persistent leak is >72h + verified-singleton locks.
- **No path can merge two singleton clusters**: Stage B+ merge requires
  member_count≥2 on both sides; A.5 only moves unverified singletons published
  <72h ago; Stage A only touches never-clustered items. Singleton twins that
  survive 72h are permanent duplicates.

## Digest contamination

412 of 1,111 multi-member clusters (37%) contain an item from a digest-style
source (AI HOT Curated Pool, AI Chat-Group Daily 群聊日报, *Daily*). Digest
items are multi-topic by construction; they glue unrelated events together
(e.g. cluster 48183, 15 members, max intra-pair distance 0.510: White-House-
restricts-GPT-5.6 event + GPT-5.6-release event + two 群聊日报 digests),
inflate the log2 coverage boost, and dominated the historical split loop.

## Worst intra-cluster cohesion (14d, possible bad merges)

| cluster | members | max d | mean d | title |
|---|---|---|---|---|
| 48183 | 15 | 0.510 | 0.267 | 白宫要求 OpenAI 分阶段发布 GPT-5.6… |
| 48399 | 10 | 0.401 | 0.253 | Anthropic 发布 Claude Science 桌面应用… |
| 48395 | 6 | 0.353 | 0.215 | Anthropic 发布 Claude Sonnet 5… |
| 48376 | 3 | 0.329 | 0.257 | 美国电力行业并购额创新高… |
| 48949 | 10→11 | 0.309 | 0.186 | 苹果起诉OpenAI指控前员工窃取商业机密 |

## Pipeline cadence facts

- Cron `/api/cron/cluster` at `:12,:42` (30-min ticks, 48/day).
- Stage caps per tick: A 200 items, A.5 150 singletons, B 15 arbitrations,
  C 15 titles, D 8 commentaries; merge recency 6h, A.5 recency 72h.
- Arbitrate order `member_count DESC` — big clusters first; C same.
