# Cross-Source Event Aggregation — Design

> **Status:** approved 2026-04-24 (autonomous execution green-lit by user)
> **Seed:** `docs/HANDOFF-AGGREGATION.md` (prior-session design sketch)
> **Scope:** Tier 4 / big-bang one-PR ship, gated by offline backtest
> **Engine:** superpowers (brainstorming → writing-plans → subagent-driven-development → code-review → verification)

---

## 1. Context

Today a single real-world event (e.g. "OpenAI releases GPT-5.5") produces one feed card **per covering source**. 10 sources × 10 cards = 10 enrichments + 10 scorer calls + 10 commentary generations + 10 visually-redundant items in the feed. Three consequences:

1. **Visual spam:** featured feed fills with the same story, differently titled.
2. **Cost:** commentary runs N× for the same event.
3. **Lost signal:** coverage count is the single best editorial importance indicator, and it's being discarded after enrich.

We already have most of the dedup infrastructure: `clusters` table, pgvector HNSW, cosine-similarity worker, and a feed-level `clusterId IS NULL OR leadItemId = items.id` filter. But the existing design treats clusters as a **dedup pointer**, not as **editorial events** — titles, commentary, importance, and tier all live on items, not on the cluster.

## 2. Goal

Promote `clusters` to first-class **events**: canonical LLM-generated titles, event-level commentary, coverage-boosted importance, two time views (trending-today + archive), and a signal drawer that surfaces the contributing members.

## 3. Non-goals

- **Per-member roles** (`primary` / `corroborating`) — YAGNI. Lead item + `ORDER BY importance DESC, published_at ASC` is sufficient.
- **Admin UI** for manual event merging / splitting — deferred until post-ship if operator ops demand it.
- **Dedicated `/event/:id` permalink page** — signal drawer on the card is enough for v1; standalone event page is a future phase.
- **Re-embedding items with article body** — only if backtest shows recall failure. Default: keep existing `title + summaryZh` embedding input.
- **Cross-lingual summary/analysis regeneration beyond cluster formation** — existing bilingual fields stay.

## 4. Architecture Overview

```
  raw_items ──► items ──► [enrich] ──► items.{titleZh/En, summaryZh/En, importance, tier, embedding}
                                           │
                                           ▼
                                      [Stage A: cosine cluster, 0.80 / ±72h, published-anchor]
                                           │
                                           ▼
                                      member_count ≥ 2?  ──no──► singleton cluster, done
                                           │ yes
                                           ▼
                                      [Stage B: Haiku LLM arbitrate]
                                           │
                                           ├─ keep all   ──► cluster.verified_at = now()
                                           └─ split out  ──► unlink item, new singleton, log to cluster_splits
                                           │
                                           ▼
                                      [Stage C: Haiku canonical title (zh+en)]
                                           │
                                           ▼
                                      [Stage D: event commentary (tier ∈ featured/p1)]
                                           │
                                           ▼
                                      [importance recompute: base + log2(1+coverage)*6]
                                           │
                                           ▼
                                      persist → feed (Today view + Archive view)
```

## 5. Schema Changes

### 5.1 `clusters` — extended in place (aliased as "events" in TS)

```sql
ALTER TABLE clusters ADD COLUMN canonical_title_zh TEXT;
ALTER TABLE clusters ADD COLUMN canonical_title_en TEXT;
ALTER TABLE clusters ADD COLUMN summary_zh TEXT;
ALTER TABLE clusters ADD COLUMN summary_en TEXT;
ALTER TABLE clusters ADD COLUMN editor_note_zh TEXT;
ALTER TABLE clusters ADD COLUMN editor_note_en TEXT;
ALTER TABLE clusters ADD COLUMN editor_analysis_zh TEXT;
ALTER TABLE clusters ADD COLUMN editor_analysis_en TEXT;
ALTER TABLE clusters ADD COLUMN commentary_at TIMESTAMPTZ;
ALTER TABLE clusters ADD COLUMN importance INTEGER;
ALTER TABLE clusters ADD COLUMN event_tier TEXT;           -- featured | p1 | all | excluded
ALTER TABLE clusters ADD COLUMN hkr JSONB;
ALTER TABLE clusters ADD COLUMN coverage INTEGER DEFAULT 1;
ALTER TABLE clusters ADD COLUMN latest_member_at TIMESTAMPTZ;
ALTER TABLE clusters ADD COLUMN verified_at TIMESTAMPTZ;    -- Stage B lock
ALTER TABLE clusters ADD COLUMN titled_at TIMESTAMPTZ;      -- canonical_title generation timestamp

CREATE INDEX clusters_latest_member_at_idx ON clusters(latest_member_at DESC);
CREATE INDEX clusters_tier_latest_idx ON clusters(event_tier, latest_member_at DESC);
CREATE INDEX clusters_first_seen_at_idx ON clusters(first_seen_at DESC);
```

**Why extend, not rename:** preserves `items.cluster_id` FK, every existing cluster ID, and every row reference. Migration is purely additive (ADD COLUMN × N). Rollback = `ALTER TABLE clusters DROP COLUMN …`, zero data destruction.

**TS aliasing for semantic clarity** (in `db/schema.ts`):

```ts
export const events = clusters;                    // runtime same pointer
export type Event = typeof clusters.$inferSelect;  // type alias
export type NewEvent = typeof clusters.$inferInsert;
```

New code imports `events`; existing code using `clusters` continues to work without changes during rollout.

### 5.2 `items` — one new column

```sql
ALTER TABLE items ADD COLUMN cluster_verified_at TIMESTAMPTZ;
CREATE INDEX items_cluster_verified_idx ON items(cluster_verified_at) WHERE cluster_verified_at IS NULL;
```

Stage B verdict lock. Items with `cluster_verified_at IS NOT NULL` are skipped by Stage A (their cluster assignment has been LLM-confirmed).

### 5.3 `cluster_splits` — new audit table

```sql
CREATE TABLE cluster_splits (
  id SERIAL PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  from_cluster_id INTEGER NOT NULL,   -- no FK; clusters can be deleted, audit survives
  reason TEXT NOT NULL,               -- Stage B's textual justification
  split_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX cluster_splits_recent_idx ON cluster_splits(split_at DESC);
```

Audit trail for Stage B's "not same event" verdicts. Enables weekly operator review + serves as future training signal for prompt tuning.

## 6. Pipeline Stages

### 6.1 Stage A — Embedding clustering (tuning)

**File:** `workers/cluster/index.ts`

| Parameter | Before | After |
|---|---|---|
| `SIMILARITY_THRESHOLD` | 0.88 | **0.80** (wider recall; Stage B filters precision) |
| `WINDOW_HOURS` | 48 | **72** (cross-language coverage typically lags 24-48h) |
| Window anchor | `now()` | **target item's `published_at`** (bidirectional ±72h) |
| Verified skip | — | **`WHERE cluster_verified_at IS NULL`** on candidate neighbors |

Window SQL change (line ~100 of current worker):

```sql
-- Before:
AND i.published_at > now() - make_interval(hours => ${WINDOW_HOURS})

-- After:
AND i.published_at BETWEEN
    (SELECT published_at FROM items WHERE id = ${itemId}) - make_interval(hours => ${WINDOW_HOURS})
    AND
    (SELECT published_at FROM items WHERE id = ${itemId}) + make_interval(hours => ${WINDOW_HOURS})
AND i.cluster_verified_at IS NULL
```

**Embedding input unchanged:** `${title}\n\n${summaryZh}` (populated by `workers/enrich/index.ts:173`). The summary is the LLM-normalized "what this item is" — already the right signal density for clustering.

### 6.2 Stage B — LLM arbitration

**New file:** `workers/cluster/arbitrate.ts`

**Trigger:** inline with Stage A. Within one cron tick, after all Stage A assignments complete, enumerate clusters where:
- `member_count ≥ 2` AND `verified_at IS NULL`, OR
- `verified_at IS NOT NULL` BUT ≥1 member has `cluster_verified_at IS NULL` (new unverified member joined)

**Budget:** `MAX_ARBITRATIONS_PER_RUN = 15`. Exceeding defers to next tick. Order by `memberCount DESC` then `updatedAt DESC` (biggest + freshest first).

**Input to Haiku:**
```
members: [
  { source: 'openai-blog', titleZh: '...', titleEn: '...', publishedAt: '...' },
  { source: 'hn', titleZh: '...', titleEn: '...', publishedAt: '...' },
  ...
]
leadSummary: '{lead item summaryZh}'
```

**Structured output:**
```ts
{
  verdict: 'keep' | 'split',
  rejectedMemberIds?: number[],   // only if verdict='split'
  reason: string                   // ≤ 280 chars, for cluster_splits.reason
}
```

**Effect:**
- `keep`: `UPDATE clusters SET verified_at = NOW()` + `UPDATE items SET cluster_verified_at = NOW() WHERE cluster_id = $c`
- `split`: for each rejected `item_id`:
  - `UPDATE items SET cluster_id = NULL, clustered_at = NULL WHERE id = $i`
  - `INSERT INTO cluster_splits (item_id, from_cluster_id, reason) VALUES …`
  - `UPDATE clusters SET member_count = member_count - 1 WHERE id = $c`
  - Surviving members marked verified

**Budget-cap behavior:** on overflow, arbitrator silently defers. Next run picks up the backlog. Workers observability (existing `llm_usage` + `/api/health` dashboards) surfaces the queue depth.

### 6.3 Stage C — Canonical title generation

**New file:** `workers/cluster/canonical-title.ts`

**Trigger:** clusters where
- `member_count ≥ 2`, AND
- (`canonical_title_zh IS NULL` OR `member_count` changed by ≥ 2 since `titled_at`, OR Stage B reshuffled)

**Skip:** singletons. Use item's own `titleZh` / `titleEn` at read time.

**Input:** all member titles (both locales, deduped) + lead item's `summaryZh` + source display names.

**Haiku structured output:**
```ts
{
  canonicalTitleZh: string,   // 8-14 Chinese chars, neutral, no marketing
  canonicalTitleEn: string,   // 8-14 English words, neutral, no marketing
}
```

**System prompt constraints:**
- Neutral tone (no "BREAKING", "MUST READ", "shocking")
- Factual only — don't editorialize
- Short enough to fit in one line on the feed card at 1024px viewport
- Locale-native idioms (don't literal-translate zh↔en)

**Cost:** ~350 input / ~40 output tokens on Haiku ≈ $0.0001/event. Negligible vs commentary.

### 6.4 Stage D — Event-level commentary

**New file:** `workers/cluster/commentary.ts` (logic lifted from `workers/enrich/commentary.ts`, refactored to take event input)

**Trigger:** clusters where `event_tier IN ('featured', 'p1')` AND `commentary_at IS NULL`.

**Input:** all member titles + richest member's `bodyMd` (truncated to ~8k chars) + member source mix context.

**Output:** `editor_note_zh/en` + `editor_analysis_zh/en` — same shape as existing per-item commentary, written to clusters row.

**Per-item commentary deprecated for multi-member clusters:** after migration, `workers/enrich/index.ts` no longer generates commentary for items that will join a cluster. Singletons continue to get per-item commentary at enrich time (same as today) and this commentary is copied to their singleton cluster row.

### 6.5 Importance + Tier recomputation

**When triggered:** any cluster member_count change, Stage B verdict, or initial seed.

```ts
function recomputeEventImportance(cluster: Event, members: Item[]): { importance: number; tier: EventTier } {
  const base = Math.max(...members.map(m => m.importance ?? 0));
  const coverage = members.length;
  const boost = Math.round(Math.log2(1 + coverage) * 6);
  const importance = Math.min(base + boost, 100);
  const tier = tierBucketFor(importance);  // existing thresholds, reused
  return { importance, tier };
}
```

Thresholds in `tierBucketFor` are unchanged from today's per-item scorer.

## 7. Read Path Changes

### 7.1 `lib/items/live.ts` rewrite

**Two query shapes, one file:**

#### Today view (home / trending)

```sql
WHERE (
  cluster.first_seen_at >= $today_start::timestamptz
  OR cluster.latest_member_at > now() - interval '24 hours'
  OR (items.cluster_id IS NULL AND items.published_at >= $today_start::timestamptz)
)
AND (items.cluster_id IS NULL OR cluster.lead_item_id = items.id)   -- dedup (unchanged)
AND COALESCE(cluster.event_tier, items.tier) IN ('featured', 'p1')
ORDER BY COALESCE(cluster.latest_member_at, items.published_at) DESC, COALESCE(cluster.importance, items.importance) DESC
LIMIT 40
```

#### Archive view (`/all?date=X`)

```sql
WHERE DATE(COALESCE(cluster.first_seen_at, items.published_at)) = $date
AND (items.cluster_id IS NULL OR cluster.lead_item_id = items.id)
ORDER BY COALESCE(cluster.first_seen_at, items.published_at) DESC,
         COALESCE(cluster.importance, items.importance) DESC
```

The `COALESCE(cluster.X, items.X)` pattern means **singletons continue to behave exactly as today** — only multi-member events pull their metadata from the cluster row.

### 7.2 `FeedQuery` type additions

```ts
export type FeedQuery = {
  // ... existing fields ...
  view?: 'today' | 'archive';       // selects query shape. default 'today' for home
  hotWindowHours?: number;          // override 24h default for Today view
};
```

### 7.3 `Story` type additions

```ts
export type Story = {
  // ... existing fields ...
  coverage?: number;                     // >= 1; undefined for singletons
  firstSeenAt?: string;                  // ISO; cluster.first_seen_at
  latestMemberAt?: string;               // ISO; cluster.latest_member_at
  canonicalTitleZh?: string;             // cluster.canonical_title_zh
  canonicalTitleEn?: string;
  stillDeveloping?: boolean;             // derived: first_seen_at < today AND latest_member_at > now-24h
  members?: Array<{                      // for signal drawer; empty for singletons
    sourceId: string;
    sourceName: string;
    title: string;
    url: string;
    publishedAt: string;
    importance: number;
  }>;
};
```

**Rendering precedence** (in `getFeaturedStories` mapper):
- `title`: `canonical_title_<locale> ?? item.title_<locale> ?? item.title`
- `editorNote`: `cluster.editor_note_<locale> ?? item.editor_note_<locale>` (cluster wins for multi-member)
- `editorAnalysis`: same pattern
- `importance`: `cluster.importance ?? item.importance`
- `tier`: `cluster.event_tier ?? item.tier`

## 8. UX Deliverables

### 8.1 Event card badges (`components/feed/event-badge.tsx`)

Derived state from Story fields:

| Condition | Badge | zh label | en label |
|---|---|---|---|
| `!coverage` AND firstSeen = today | NEW | 新 | NEW |
| `coverage ≥ 2` AND firstSeen = today | NEW · N sources | 新 · N 信源 | NEW · N sources |
| `coverage ≥ 2` AND firstSeen < today AND stillDeveloping | STILL DEVELOPING | 持续报道 · 距首报 Nd | STILL DEVELOPING · N days in |
| `coverage ≥ 2` AND !stillDeveloping | — (quiet card) | 由 N 信源报道 | N sources |

### 8.2 Coverage chip

Small inline element next to source name on cards with `coverage ≥ 2`:

```
[📰 N] or [N 信源]
```

### 8.3 Signal drawer (`components/feed/signal-drawer.tsx`)

Click anywhere on the coverage chip → expands a drawer (inline accordion, not modal) listing all members:

```
┌─ 由 8 个信源报道 ──────────────────────────────────────┐
│ 📎 OpenAI 官方博客       · 3h ago  · GPT-5.5 发布公告    │
│ 📎 The Information       · 2h ago  · GPT-5.5 Leaks …    │
│ 📎 量子位                · 1h ago  · 深度：GPT-5.5 …    │
│ 📎 Simon Willison's blog · 45m ago · Notes on GPT-5.5 … │
│ … 4 more                                                │
└─────────────────────────────────────────────────────────┘
```

Each row:
- Source icon + name
- Relative time
- Title (locale-matched, click → original article)
- Importance badge (if the member contributes unique angle)

Order: `importance DESC, published_at ASC`. Collapsed by default; keyboard-accessible expand.

### 8.4 Home feed behavior change

Existing `app/[locale]/page.tsx` home route switches to `view=today` query. Same `getFeaturedStories` API, new query param. Result: the top of the page now shows trending (new-today + ongoing) rather than strict publishedAt DESC.

Default `hotWindowHours = 24`. Can be overridden via `?hot=48` for power users.

### 8.5 Archive routes

`/[locale]/all?date=YYYY-MM-DD` behavior unchanged from reader perspective — still shows events on their calendar day — but multi-member events now render the signal drawer on that archive view too.

## 9. Data Migration

**Script:** `scripts/migrate/events-from-clusters.ts`

Sequence (all idempotent, safe to re-run):

1. **Schema add** (drizzle-kit push --force + `bun run db:hnsw` to restore HNSW index — per handoff operational note).
2. **Backfill `latest_member_at`:**
   ```sql
   UPDATE clusters c
   SET latest_member_at = sub.max_pub
   FROM (SELECT cluster_id, MAX(published_at) AS max_pub
         FROM items WHERE cluster_id IS NOT NULL GROUP BY cluster_id) sub
   WHERE c.id = sub.cluster_id;
   ```
3. **Backfill `first_seen_at`** (should already be set from cluster worker, verify with MIN(published_at) fallback):
   ```sql
   UPDATE clusters c
   SET first_seen_at = sub.min_pub
   FROM (SELECT cluster_id, MIN(published_at) AS min_pub
         FROM items WHERE cluster_id IS NOT NULL GROUP BY cluster_id) sub
   WHERE c.id = sub.cluster_id AND c.first_seen_at IS NULL;
   ```
4. **Copy lead item's commentary to cluster:**
   ```sql
   UPDATE clusters c
   SET editor_note_zh    = i.editor_note_zh,
       editor_note_en    = i.editor_note_en,
       editor_analysis_zh = i.editor_analysis_zh,
       editor_analysis_en = i.editor_analysis_en,
       commentary_at     = i.commentary_at,
       hkr               = i.hkr,
       importance        = i.importance,
       event_tier        = i.tier
   FROM items i
   WHERE i.id = c.lead_item_id;
   ```
5. **Null out `commentary_at` for multi-member clusters** so Stage D regenerates with cross-source context:
   ```sql
   UPDATE clusters SET commentary_at = NULL WHERE member_count >= 2;
   ```
6. **Recompute importance with coverage boost** (post-ship, via `workers/cluster/recompute-tier.ts` backfill script):
   ```ts
   for each cluster: recomputeEventImportance(cluster, members); persist.
   ```
7. **Set coverage column:**
   ```sql
   UPDATE clusters SET coverage = member_count;  -- for now, same number; may diverge if we track "corroborating vs primary" later
   ```
8. **Leave `items.editor_note_*` / `editor_analysis_*` / `commentary_at` intact** for 1 milestone as rollback safety net. Read path falls back to item-level if cluster-level is empty (COALESCE already handles this).

Runtime: O(clusters) × small constants. 2900 items ≈ a few hundred clusters max. Expect < 30s.

## 10. Backtest Harness

**File:** `scripts/ops/backtest-cluster.ts`

**CLI:**
```bash
bun run scripts/ops/backtest-cluster.ts \
  --threshold 0.80 \
  --window 72 \
  --since '2026-04-01' \
  --stage-b                   # include Stage B arbitration (--no-stage-b to isolate Stage A)
  --output docs/reports/backtest-YYYY-MM-DD/
```

**What it does:**

1. Snapshots current `clusters` + `items.cluster_id` state to a temp dump file (enables rollback of the backtest itself).
2. Creates a shadow schema copy (`backtest_clusters`, `backtest_items`) mirroring current state.
3. Runs the tuned clustering worker against the shadow.
4. Optionally runs Stage B arbitrator on shadow.
5. Writes diff reports to `--output`:
   - `cluster-diff.md`: cluster count delta, member-count distribution shift, coverage histogram
   - `moved-items.csv`: `item_id, title, from_cluster_id, to_cluster_id, sim_distance, stage_b_verdict`
   - `spot-check-sample.md`: 30 random merged clusters, each showing all member titles + source names (operator eyeball fuel)
   - `hand-labeled-recall.md`: small seed list of ~20 known-related event pairs (operator writes this list), backtest reports merged Y/N per pair
   - `stage-b-log.jsonl`: every Stage B call + verdict (audit trail)

**Gate for shipping:**
- Spot-check sample passes operator eyeball (no obvious false merges)
- Hand-labeled recall: ≥16/20 pairs merged (80% recall target)
- Stage B split rate on the shadow < 20% of multi-member clusters (if higher, prompt needs tuning or threshold too loose)

**If gate fails:** adjust threshold (try 0.82 before re-embedding), tune Stage B prompt, re-run. Re-embedding with `title + summaryZh + summaryEn` is the fallback; body inclusion is last resort.

## 11. Rollback

- **Schema:** ADD COLUMN is reversible via DROP COLUMN. No data lost.
- **Data:** item-level commentary preserved for ≥1 milestone. Read path's `COALESCE(cluster.X, item.X)` means falling back to items-only is a one-line code revert (drop the cluster joins from SQL).
- **Feature flag:** `ENABLE_EVENT_AGGREGATION` env var. Off = use pre-migration read path. On = use event-level. Default off for first 24h after deploy; flip on once backtest operator sign-off + live observation of first cluster arbitrations look sane.
- **Feed visual revert:** if the Today view feels wrong, flip env `FEED_VIEW_MODE=legacy_publishedat_desc` to restore pre-aggregation ordering while keeping cluster pipeline running in the background.

## 12. Testing Strategy

### 12.1 Unit tests (Vitest)

- `workers/cluster/arbitrate.test.ts`: mock Haiku responses for `keep` / `split` / empty / over-budget cases. Verify `verified_at`, `cluster_splits` writes, member unlinks.
- `workers/cluster/canonical-title.test.ts`: mock Haiku, assert locale output shape + length bounds.
- `workers/cluster/importance.test.ts`: coverage formula edge cases (coverage=1, coverage=100, base=100 cap).
- `lib/items/live.test.ts`: `buildFeedWhere` with Today vs Archive views, with and without source filters.

### 12.2 Integration tests (real DB, fake LLM)

- Seed 5 items with known embeddings → Stage A clusters 3, Stage B keeps all 3, canonical-title runs, commentary runs, event surfaces in Today feed with correct badges.
- Migration: seed pre-migration state (items with commentary, clusters without), run migration script, assert invariants (no orphan items, all clusters have first_seen_at + latest_member_at, lead item commentary copied).
- Backtest harness: seed deterministic shadow state, run harness, assert diff report shape.

### 12.3 E2E (Playwright, against dev server)

- Home page renders NEW badge on first-seen-today event.
- Home page renders STILL DEVELOPING badge on multi-day event with recent coverage.
- Coverage chip reveals signal drawer on click; drawer lists all members; clicking a member opens source URL in new tab.
- `/all?date=2026-04-15` shows event once on its `firstSeenAt` day (not on subsequent days).
- Event with `coverage=1` (singleton) renders exactly like today (no regression).

### 12.4 Visual verification

Per the newsroom UI phase protocol: Playwright screenshot sweep → Claude visual-verify each changed route × theme variant against existing HANDOFF.md design tokens. New elements (badges, chips, drawer) align with terminal aesthetic.

## 13. Implementation Waves

(Detailed plan in `writing-plans` output; this is the rough shape.)

| Wave | Work | Parallelism |
|---|---|---|
| 1 | Schema migration + backtest harness + tier-importance pure-function | Serial (1 task) |
| 2 | Workers: Stage A tune / Stage B new / canonical-title new / event-commentary refactor | **Parallel worktree × 4** |
| 3 | Read path: `lib/items/live.ts` rewrite + Story type + API response mapper | Serial (dependent on Wave 2) |
| 4 | UI: event-badge + coverage chip + signal drawer + home-feed Today-view wiring | **Parallel worktree × 3** |
| 5 | Data migration script + backtest run + operator sign-off gate | Serial |
| 6 | E2E tests + visual verification + ultra-review + PR | Serial |

**Estimated wall time:** 2-3 days with heavy parallelization in Waves 2 & 4.

## 14. Files (create / modify)

### Create

```
workers/cluster/arbitrate.ts
workers/cluster/canonical-title.ts
workers/cluster/commentary.ts                  # lifted + refactored from workers/enrich/commentary.ts
workers/cluster/importance.ts                  # pure fn + tests
workers/cluster/prompt.ts                      # system prompts for Stage B + canonical title
scripts/ops/backtest-cluster.ts
scripts/migrate/events-from-clusters.ts
components/feed/event-badge.tsx
components/feed/signal-drawer.tsx
components/feed/coverage-chip.tsx
docs/aggregation/DESIGN.md                     # this file
docs/aggregation/BACKTEST-NOTES.md             # operator-written, pre-ship
docs/aggregation/HAND-LABELED-PAIRS.md         # seed list for recall check
```

### Modify

```
db/schema.ts                                    # columns + aliases
workers/cluster/index.ts                        # threshold / window / anchor / verified-skip
workers/enrich/index.ts                         # stop commentary for items-that-will-cluster
workers/enrich/commentary.ts                    # becomes singleton-only (multi-member routes to cluster commentary)
lib/items/live.ts                               # two views + COALESCE fallback
lib/items/semantic-search.ts                    # cluster-aware filter
lib/types.ts                                    # Story + FeedQuery extensions
app/[locale]/page.tsx                           # Today view wiring
app/[locale]/all/page.tsx                       # archive ordering + date semantics
components/feed/item.tsx                        # integrate badge + chip + drawer
messages/zh.json + messages/en.json             # new i18n keys
drizzle.config.ts                               # possibly nothing; schema change is additive
```

**Estimated LOC:** +900 / -150.

## 15. Decision Log

| # | Handoff Q | Decision |
|---|---|---|
| HQ1 | Rename / new table / extend in place | **Extend `clusters` in place, alias as `events` in TS types** |
| HQ2 | Per-member `primary` / `corroborating` roles | **Skip — YAGNI** |
| HQ3 | Stage B frequency | **Inline with cluster worker, cap 15 arbitrations/run** |
| HQ4 | Cold-start commentary migration | **Copy lead item's commentary to cluster; null `commentary_at` for multi-member to trigger regen; keep item-level data as rollback safety** |
| HQ5 | Stage A/B disagreement — split or keep? | **Trust B: split, unlink member, log to `cluster_splits`; `verified_at` locks re-merging** |
| Q6 | Clustering timeframe | **Rolling ±72h anchored to item's `published_at` (bug-fix: currently anchored to `now()`)** |
| Q7 | Event naming | **Haiku canonical titles for `member_count ≥ 2`, input = member titles + lead summary + source names; singletons use item's own title** |
| Q8 | Embedding input | **Unchanged (`title + summaryZh`); augment with `summaryEn` only if backtest recall fails** |
| Q9 | Time view / UX presentation | **Two views: Today (trending, ordered by `latestMemberAt DESC`, 24h hot window) + Archive (ordered by `firstSeenAt DESC`, per-day bucket); NEW / STILL DEVELOPING badges distinguish** |

## 16. Open Risks + Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Stage B over-splits legitimate merges | Medium | `cluster_splits` audit table; weekly operator review first month; adjustable system prompt |
| Threshold 0.80 over-merges unrelated zh+en stories | Medium | Spot-check gate in backtest before ship; fall back to 0.82 if flagged |
| Budget cap 15/run leaves queue growing on bursty days | Low | Observable via `llm_usage` task='arbitrate'; can bump cap based on dashboard |
| Canonical title reads generic / marketing-y | Medium | System prompt pins neutral tone; backtest spot-check includes title review; regenerate-on-demand via admin action post-ship |
| Reader confusion on multi-day events | Low | STILL DEVELOPING badge + distance-since-break chip + optional Hot Now view |
| Event commentary regeneration cost spike during migration | Low | Multi-member clusters are a minority (likely < 20%); cap concurrent commentary gen to 5; defer non-featured to queue |
| HNSW index dropped by `drizzle-kit push` | Guaranteed | Per handoff operational note, always run `bun run db:hnsw` after schema push. Documented in migration script + added to CLAUDE.md during this phase. |
| Feed layout shift on badge introduction | Low | Reserve badge space in CSS via `min-height`; visual verification sweep before ship |

## 17. Success Criteria

Ship is successful when ALL of:

1. Backtest harness passes operator gate (spot-check + hand-labeled recall).
2. Migration script runs clean on production snapshot; zero data loss.
3. Live home feed shows: at least one multi-source event with coverage chip + signal drawer populated within 24h of cutover.
4. Stage B false-split rate over first week < 10% (tracked via `cluster_splits` audit + operator review).
5. Commentary generation volume drops ≥30% week-over-week (target: 5-10× reduction per handoff — 30% is the conservative floor accounting for more frequent regeneration on cluster changes).
6. No feed regressions: existing singletons render unchanged, sort order unchanged for days with no multi-source events.
7. All unit / integration / E2E tests pass; visual verification green.

---

**End of spec. Next: `superpowers:writing-plans` consumes this to produce `PLAN.md` with per-wave task breakdown and dependency graph.**
