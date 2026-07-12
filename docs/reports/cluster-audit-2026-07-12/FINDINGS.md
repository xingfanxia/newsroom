# NEWSROOM-CLUSTER-1 — clustering pipeline audit (2026-07-12)

Deep audit of the event-clustering subsystem (`workers/cluster/*`: Stage A
greedy NN assign → A.5 singleton recluster → B LLM arbitrate → B+ merge →
C canonical titles → D commentary). Method: end-to-end code read + read-only
empirical measurement against prod (see [DATA.md](./DATA.md)) + 7-dimension
multi-agent audit with 2-lens adversarial verification per finding (95
agents; 16 findings CONFIRMED, 28 PLAUSIBLE, 0 refuted) + a dedicated
forensic trace of the member_count drift.

## Executive verdict

The architecture (greedy assign + LLM arbitration + repair stages) is sound
and the within-72h machinery demonstrably converges (the Grok-Build trio and
Mesh-LLM pair merged within a few ticks during this audit). The problems are
concrete and fixable, in five groups:

1. **The historical split-loop's root vector is still open.** The June-12 fix
   guarded Stage A/A.5 but not merge — items an arbitrator rejected can be
   reunited with the rejecting cluster via merge, and the rejection cap
   counts the wrong thing (distinct clusters, not repeats). The May–June
   storm burned ≈$100 of the ~$135 all-time cluster LLM spend and saturated
   arbitration for ~6 weeks.
2. **Lead-item integrity is unguarded** — a split can eject the lead, and the
   feed's dedup predicate then renders *nothing* for that cluster.
3. **Singleton twins >72h apart are permanently un-mergeable** — no stage can
   ever reconcile them (10 duplicate-card pairs in the last 14d, incl. p1/
   featured stories).
4. **Denormalized aggregates have no reconciler** (member_count/coverage
   drift; the 6 current cases are a migration artifact — see forensic — but
   the non-transactional claim/bump can reproduce the same shape organically).
5. **Cost/perf is un-adapted to Turso** — brute-force 3072-dim NN scans every
   tick while a 256-dim DiskANN index sits unused; stat-less-planner queries
   un-pinned; O(N) round-trips under the global write lock.

## The member_count drift — forensic conclusion

The 6 drifted clusters (3 stuck at mc=1 → excluded from arbitrate/titles/
importance forever; 1 zombie) are **not a runtime bug**: the pg→Turso copy
captured `clusters` before `items` while the Supabase pipeline was still
running, and `delta-topup.ts` was id-keyed only — UPDATEs to already-copied
rows were never reconciled, and cluster aggregates have no self-heal path
(items self-heal via `IS NULL` claim predicates; clusters don't). Timezone
proof: every "impossible" tick predates cutover (06:23 UTC 07-12) and ran
against Supabase. Verified: no rowid reuse (AUTOINCREMENT confirmed live),
no libSQL partial transactions post-cutover, 0 dangling item→cluster refs.

**Repair** (one-off, idempotent): recompute member_count/coverage/
latest_member_at from actual membership and null verified_at/titled_at for
ids 48878, 48949, 48959, 48982, 48997; delete empty 49009. The pipeline then
re-arbitrates/re-titles them on the next tick (~5 Haiku + 5 title calls).

## Fix workstreams (findings grouped by the change that closes them)

### W1 — Close the split-loop vector [HIGH, cheapest/highest value]

- `merge.ts:280` moves loser items into the winner with **no cluster_splits
  check**; a rejected item re-enters the rejecting cluster via any twin
  cluster that merges in. CONFIRMED.
- `split-audit.ts:9` cap counts `DISTINCT from_cluster_id` — same-cluster
  ping-pong (the dominant historical pattern, top pair 2,174×) never
  advances it. CONFIRMED. `cluster_splits` also has no unique index, so
  re-rejections append unboundedly.
- Fix: (a) in `mergeClusters`, exclude items with a split row against the
  winner (leave them unclustered rather than reunite); (b) cap on
  `count(*)` per (item, cluster) pair too — or simply make the negative
  edge absolute: never rejoin a (item, cluster) pair, ever; (c) unique
  index on `cluster_splits(item_id, from_cluster_id)` with upsert.

### W2 — Lead integrity [HIGH, user-visible]

- `arbitrate.ts:311` split can unlink the item that *is*
  `clusters.lead_item_id` without re-picking; Stage C's re-pick never runs
  for clusters that drop to member_count=1 (`>= 2` gate). 11 clusters
  currently dangling → the feed dedup (`live.ts:129` — `cluster_id IS NULL
  OR lead_item_id = items.id`) renders **nothing** for them (10 items
  hidden; mostly excluded-tier today, but a featured-event lead split would
  silently hide the event). CONFIRMED.
- Fix: after a split, re-pick lead via `pickBestLead` over survivors
  (works for 1 survivor too); belt-and-braces: feed-side fallback (`OR NOT
  EXISTS (lead row in cluster)` guard, or a repair sweep in cluster-health).
- Related: merge (`merge.ts:297`) keeps the winner's lead even when the
  loser's lead is higher-authority — acceptable since Stage C re-picks on
  retitle, but worth folding into the same helper.

### W3 — Aggregate bookkeeping [MEDIUM, integrity]

- `index.ts:288-316` claim + member_count bump are two autocommit statements
  (promote-neighbor path is three) — a crash/timeout between them produces
  exactly the drift shape organically. CONFIRMED (shape verified; current 6
  cases are migration artifacts). Fix: wrap in `client.transaction` /
  `batch(…, "write")`.
- `arbitrate.ts:338` decrements member_count but not coverage → the 104
  coverage≠member_count drifts; `index.ts:313` then half-heals coverage
  non-deterministically. Decide coverage's meaning (currently it's a
  member_count clone) — either drop the column or keep them in lockstep.
- Add a reconciler: cluster-health already measures drift; add `--repair`
  (recompute aggregates via one GROUP-BY join) and run it in the pipeline
  or weekly. Drift should be an alarm, not a fact of life.
- One-off: repair the 6 migration-artifact clusters (SQL above).

### W4 — Recall: singleton twins & locks [HIGH]

- **>72h twins are permanent**: A.5's window is `published_at > now-72h`
  (`singletons.ts:123`) and its neighbor window ±72h around the item; merge
  needs mc≥2 both sides; Stage A only sees never-clustered items. No path
  merges two singletons >72h apart. CONFIRMED with live pairs (Dan Luu
  d=0.094 gap 111h; NotebookLM d=0.170 gap 166h). But beware: some >72h
  near-pairs are correctly separate (Claude Code v2.1.198/.202/.206,
  d≈0.15) — the fix must be arbitrated, not a blanket window widening.
  Proposal: a low-frequency (daily) singleton-twin sweep: candidate pairs
  (d≤0.20, any age gap, capped N) → the *arbitrate LLM* judges same-event →
  merge on keep-verdict. Reuses existing stages; bounded cost (~10-30
  pairs/day).
- **Verified-singleton lock**: `arbitrate.ts:344` stamps lone survivors
  `cluster_verified_at` → 90 singletons permanently excluded from A.5
  (`singletons.ts:132` filter). "Not same as its old siblings" ≠
  "permanently solo". Fix: don't stamp when survivors=1, or drop the
  verified filter from A.5 (the split negative-edge already prevents
  rejoining the rejected cluster).
- **Prefer-clustered bias unbounded** (`index.ts:202`): joins a borderline
  clustered neighbor (0.249) over a near-certain twin (0.02). PLAUSIBLE —
  convergence usually rescues it (twin later joins the same cluster), but
  it feeds chaining drift. Fix: bound with a relative delta (prefer
  clustered only if `d_clustered ≤ d_unclustered + 0.05` or similar).

### W5 — Precision: chaining, digests, keyword lists [MEDIUM]

- **Single-link chaining** (`index.ts:162` LIMIT 1 nearest member, no
  cohesion check): cluster diameter unbounded — empirical: cluster 48183
  (15 members, max_d 0.510) fuses the White-House-restriction event with
  the GPT-5.6-release event via digest bridges. CONFIRMED. Fix: cohesion
  gate at join time (also check distance to cluster lead, reject if
  > ~0.35) — cheap, one extra vector compare.
- **Digest contamination**: 37% of multi clusters contain a digest item
  (群聊日报/AI HOT); digests are multi-topic, glue events together, inflate
  the log2 coverage boost, and dominated the loop items. Fix: add
  `sources.clustering_opt_out` (or group-level rule) — digest items skip
  Stage A entirely (they're curation, not event coverage). PLAUSIBLE→
  worth doing; cheap flag.
- **No-content keyword list** (`merge.ts:126`): LIKE list coupled to Stage
  C's LLM phrasing by coincidence (drift already observed); plus the
  `NOT(noContentSkip)` NULL-exclusion bug for untitled clusters
  (`merge.ts:156`, CONFIRMED — self-heals next tick normally, but starves
  under wave load). Fix: replace with a structural `clusters.no_content`
  flag stamped by Stage C when it detects no-content (schema-level
  contract), and NULL-guard the predicate (`COALESCE(NOT(...), 1)`).

### W6 — Staleness: tombstones & frozen commentary [HIGH]

- **Verification is a permanent tombstone** (`arbitrate.ts:96`): a wrong
  "keep" is never revisited (48183 stays fused forever). CONFIRMED. Fix:
  cheap deterministic re-open — when a verified cluster's max intra-pair
  distance exceeds a threshold (or on every +3 members), null verified_at.
- **Stage D freezes** (`commentary.ts:100`): commentary never regenerates
  on Stage-A member growth (only merge/A.5 moves reset it) — a 2-member
  event commented early keeps its note as it grows to 10 sources; tier
  upgrades don't retrigger the full-analysis path. CONFIRMED. Fix:
  regenerate when member_count grew ≥2× since commentary_at, or when
  event_tier crossed into featured/p1.
- A.5 move doesn't recompute target importance/tier (`singletons.ts:285`)
  → multi-tick under-ranking window. Fold importance recompute into the
  move (pure function already exists).

### W7 — Cost/perf, Turso-adapted [HIGH on cron budget]

- **A.5 rescans everything every tick** (`singletons.ts:161`): ~91
  singletons × full brute-force 3072-dim scan ≈ 25s/tick with ~100% waste
  (same negatives re-checked 144×/72h). CONFIRMED. Fix: track
  `last_recheck_at` (or process only singletons whose neighborhood changed
  — new items in window) + move NN to the 256-dim path (below).
- **Stage A/A.5 don't use the DiskANN index**: brute-force
  `vector_distance_cos` over full 3072-dim blobs (12KB/row reads), while
  `items_embedding_small_idx` (256-dim, built for semantic search) exists.
  Fix: `vector_top_k` on the small index for candidates → exact re-rank
  with full vectors (same two-phase pattern semantic search ships). Also
  halves compute by avoiding the SELECT+ORDER double cosine eval.
- **Pins**: zero `INDEXED BY` in workers/cluster; arbitrate/C/D candidate
  queries full-scan `clusters` per tick (16k rows, correlated EXISTS).
  Add partial index on `clusters(member_count)` or a covering candidate
  index + pins + PLAN_CHECKS entries in db-optimize.ts.
- **Write-lock hygiene**: `applySplitVerdict` holds the global write lock
  across 2×N network round-trips (`arbitrate.ts:311`) — collapse to 3
  set-based statements.
- **Cron budget**: whole pipeline shares one 800s invocation; Stage A worst
  case + merge O(M²·k²) can eat it. Bound merge `--all`, and consider
  splitting stages across two cron routes if timings creep.
- **Stage D EN call generates+discards zh fields** (`commentary.ts:246`) —
  slim the schema per-locale.

### W8 — Tests [MEDIUM]

Feed/cluster data-integrity layer has zero behavioral tests — existing
tests mirror SQL strings. Add characterization tests for: merge respects
split negative-edges; split re-picks lead; dedup never hides a cluster;
member_count reconciliation; noContentSkip NULL semantics; A.5 lock
semantics. (Names + assertion sketches in the workflow findings JSON.)

## Suggested sequencing

1. **Today-ish (safety, minutes each)**: repair the 6 drifted clusters +
   delete zombie; W1(a+c) merge split-guard + unique index; W2 lead re-pick
   on split.
2. **This week**: W3 transactions + reconciler; W5 NULL-guard + digest
   opt-out flag; W6 A.5 importance recompute; W7 A.5 waterline + INDEXED BY
   pins.
3. **Next**: W4 singleton-twin arbitrated sweep; W5 cohesion gate + no_content
   flag; W6 tombstone re-open + commentary regen policy; W7 DiskANN routing;
   W8 tests alongside each.

Raw verified findings (evidence, verifier reasoning, per-item fix text):
session workflow `wf_f05b7346-d5f`; extraction in the session scratchpad.
Empirical measurements + repro commands: [DATA.md](./DATA.md). Health
check: `bun --env-file=.env.local scripts/ops/cluster-health.ts`.
