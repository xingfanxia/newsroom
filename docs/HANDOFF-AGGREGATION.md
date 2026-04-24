# AX's AI RADAR — Handoff to aggregation session (2026-04-24)

> **Read this first.** Prior handoffs: [`HANDOFF.md`](./HANDOFF.md) (s8, 2026-04-19/20) + s9 shipped the AGENT-MCP plan in commits `d968a29` → `c7394bc`. This handoff covers a short polish session on 2026-04-24 and **preserves the design for the next session's goal: cross-source event aggregation**.

---

## Session 2026-04-24 — what shipped

Pushed to `origin/main`, two commits:

| SHA | Title |
|-----|-------|
| `d126f2c` | `feat(feed): source picker, never-exclude flag, editor-note/analysis visual split` |
| `2b5f9c7` | `feat(nav): replace low-follower placeholder with AX curated tab` |

### The five reported issues

1. **Couldn't filter by specific 信源** → new `?source_id=<id>` URL param on `/` and `/all`, consumed by `getFeaturedStories` (already supported `sourceId`; just wasn't exposed). Preset pills + `source_id` are mutually exclusive.
2. **Left-rail search was disabled** → `components/shell/source-picker.tsx` (new). Functional picker with ⌘K, arrow-key nav, module-level source cache, clearable active-source chip. Backed by new `GET /api/sources/active` (public list of enabled sources, id/name/kind/group only).
3. **Ticker too fast** → `app/terminal.css:788` animation 60s → 120s.
4. **编辑点评 + 深度解读 visually merged** → split into two distinct treatments: `.kv.tldr` (orange left-border callout, TL;DR) vs `.kv.analysis` (purple long-form panel, 72ch measure, label above). `components/feed/item.tsx` applies the new classnames.
5. **Aggregation/dedup** — **deferred to next session** (see below).

### Side quest — 群聊日报 source invisible

User couldn't find 群聊日报 entries after filtering. Root cause: scorer excluded all 8 items as "daily chatter / filler" (the HKR rubric expects single-event-hook news, not digests). Fixed at the source of the problem:

- New `sources.never_exclude` bool column — replaces the hardcoded `*-yt` tier-floor in `workers/enrich/index.ts:198-206`. When true, scorer verdict of `excluded` is promoted to `all`. YouTube channels (4) + `ai-chatgroup-daily` are flagged.
- New `sources.curated` bool column — distinct concept, UI-level opt-in for the 严选 tab. `ai-chatgroup-daily` is flagged.
- Loaded once per enrich run into a `Set<sourceId>` so the check is O(1).
- 8 existing excluded 群聊日报 items promoted directly via UPDATE (scorer's HKR "reason failed" text kept intact — it's still truthful, just overridden by operator trust).

### Nav change — 低粉爆文 → AX 严选

Low-follower tab was coming-soon placeholder, never built. Replaced with AX 严选:
- New `/[locale]/curated` page, shows items from `sources.curated = true` at tier=all.
- Old `/[locale]/low-follower/page.tsx` deleted.
- i18n keys `lowFollower` → `curated` in both messages files.
- Nav test updated.

### Deferred this session

- **Admin UI for curated / never_exclude flags** — explicit punt by user. Currently:
  ```sql
  UPDATE sources SET curated = true WHERE id = '<id>';
  UPDATE sources SET never_exclude = true WHERE id = '<id>';
  ```
  Revisit when a 3rd non-trivial source flag lands or operator starts adjusting weekly. Natural home: `/admin/sources` with inline toggles reusing `/api/v1/sources` shape.

### Operational notes

- **drizzle push drops unknown indexes** — pgvector HNSW (`items_embedding_hnsw_idx`) is created via `scripts/ops/db-create-hnsw.ts` and gets DROPPED by `drizzle-kit push` every time because drizzle doesn't model it. **Always run `bun run db:hnsw` after `bun run db:push`.** Documented here for the next schema change.
- Dev server left running on `:3009` (bash id was `bibe7u7kr` earlier this session).

---

## Data state (end 2026-04-24)

- **sources**: `never_exclude=true` on 5 rows (4 YouTube + ai-chatgroup-daily), `curated=true` on 1 row (ai-chatgroup-daily).
- **items**: 8 rows flipped from `excluded` → `all` (ai-chatgroup-daily).
- Schema changes applied to the live DB via `drizzle-kit push --force` (user's workflow — no migration files in `db/migrations/`).

---

## Next session goal: cross-source event aggregation

This was issue #5 from the session. User's instinct was right; I proposed a design; we agreed to run it through `/big-task` next time. **The design below is the starting point — not a decided plan. Treat it as the artifact that seeds `/gsd-discuss-phase`.**

### The problem

Today a single real-world event (e.g. "OpenAI releases GPT-5.5") produces one feed card **per covering source** — 10 sources × 10 cards, each enriched + scored + commentary'd independently. Three bad outcomes:

1. **Visual spam**: featured feed fills with redundant titles.
2. **Cost**: commentary runs 10× for the same event (~5–10× fan-out waste measured).
3. **Lost signal**: coverage count is the single best importance signal — it's being discarded.

### Existing infrastructure

The codebase already has most of what's needed:

- `clusters` table (`db/schema.ts:209`) with `leadItemId` + `memberCount`.
- `workers/cluster/index.ts` runs pgvector cosine similarity at threshold 0.88 over a 48h window.
- `lib/items/live.ts:61` already dedupes via `clusterId IS NULL OR leadItemId = items.id`.
- `crossSourceCount` already surfaces to the UI (currently unused).

**What's missing: the design treats clusters as a dedup mechanism, not as events.** Titles, commentary, HKR, and importance all live on items, not on the cluster. And the 0.88 threshold is too strict for cross-language cases (zh blog post + en tweet about same event).

### Proposed design

**Rename `clusters` → `events` semantically** (or add a distinct `events` table + `event_members`, tbd during phase planning). Move per-event fields off items:

```
events(
  id,
  canonical_title_zh / _en,      -- LLM-generated event name, neutral
  summary_zh / _en,
  editor_note_zh / _en,          -- ONE per event, not N per item
  editor_analysis_zh / _en,
  importance,                    -- max(member.importance) + log2(1+coverage)*6
  tier, hkr,
  coverage,                      -- count of members
  first_seen_at, commentary_at
)
event_members(
  event_id, item_id,
  role,                          -- 'primary' | 'corroborating'
  contribution_note              -- optional, what this source adds
)
```

`items` stays the raw-signal layer for `/all`.

### Pipeline stages

**Stage A (already exists, tune)**: Embedding-based cosine clustering.
- Drop threshold 0.88 → 0.80 for looser recall (cross-language parallels typically 0.75–0.85).
- Widen window 48h → 72h (hot topics span days).

**Stage B (new)**: LLM arbitration on clusters with `member_count ≥ 2`.
- Use Haiku (cheap) to look at member titles + decide "same event y/n? merge / split / keep".
- Catches the multilingual + rephrased-title cases embedding misses.
- Daily batch, not per-item.

**Stage C (new)**: Commentary moved from item-level to event-level.
- `tier ∈ (featured, p1)` + `commentary_at IS NULL` **events** (not items) get commentary.
- Input: all member titles + the richest member's `bodyMd`.
- Expected cost reduction: 5–10× on active days.

**Importance boost**: `final = base + round(log2(1 + coverage) * 6)` capped at 100. 2 sources +6, 4 sources +12, 8 sources +18. Reflects real editorial truth: more coverage = more important.

### UI deliverables

- **Signal strip on event card**: "由 N 个信源报道" chip on the featured item.
- **Signal drawer**: click to expand → list of contributing members (source name + time + title), each clickable to original article or to `/all?source_id=`.
- **Event title canonical**: use `events.canonical_title_*` rather than lead item's title (the lead might be a marketing headline; LLM-generated neutral name reads better).

### Why embedding + LLM arbitration, not pure LLM

User's instinct ("let LLM dedup by title") is correct for quality but wrong for cost:
- Pure LLM is O(n²) pairwise or needs a stateful agent.
- Embedding → pgvector HNSW is O(log n), already indexed.
- **Embedding as candidate generator + LLM as arbitrator** = O(n) + O(events). Each event pays 1 LLM call, not N.

### Migration risk

- Moving commentary from items to events means existing per-item commentary is either (a) migrated to their cluster's lead or (b) re-generated fresh. Decide in plan phase.
- Back-compat: if `events` is a new table rather than renaming clusters, old code paths can read both during transition.
- Feature-flag rollout: run the new event-level commentary generator alongside the old item-level one for a few cron ticks, compare output quality, then flip the read path.

### Expected scope

- Schema migration + data backfill (map existing clusters → events if renaming).
- `workers/cluster/` changes (threshold, window, Stage B LLM pass).
- New `workers/event-commentary/` (or rename the existing one).
- `lib/items/live.ts` query rewrite to join events.
- UI: Item component adds signal drawer; CalendarGrid + filters still work.
- **Tier 4** in the process ladder — **full GSD** (discuss → plan → execute), likely 2 days.

### Starting command for next session

```
/big-task  "cross-source event aggregation — move clusters up to first-class events, commentary at event level, signal drawer in UI, importance boost by coverage"
```

Or explicitly:
```
/gsd-discuss-phase aggregation
```

Both entry points route to the right place. `/big-task` auto-picks tier based on file count + schema involvement.

### Files to read first

1. `docs/HANDOFF-AGGREGATION.md` — this file.
2. `db/schema.ts` — the `clusters`, `items`, `sources` tables as they are today.
3. `workers/cluster/index.ts` — existing embedding pipeline.
4. `workers/enrich/index.ts` — existing commentary fan-out (item-level).
5. `workers/enrich/commentary.ts` — commentary generator (input = item).
6. `workers/enrich/prompt.ts` — `commentaryUserPrompt` (what the LLM sees).
7. `lib/items/live.ts` — `buildFeedWhere` + the dedup filter on clusters.
8. `components/feed/item.tsx` — where the signal drawer would go.

---

## Open questions for the next session to resolve

1. **Rename or new table?** Renaming `clusters → events` is cleaner semantically; adding an `events` table alongside preserves rollback simplicity. Decide in discuss phase.
2. **Per-member roles?** `primary` / `corroborating` might be overkill; could just order by `importance DESC, published_at ASC`. Defer if uncertain.
3. **Stage B batch frequency?** Daily? Hourly? Only on new clusters with ≥ N members? Tune against LLM cost budget.
4. **Cold-start migration** — what happens to the 2900 existing items with commentary, once commentary moves to event level? Preserve-all-data migration vs regenerate-on-next-tick — cost/quality tradeoff.
5. **Fallback**: If LLM Stage B disagrees with embedding Stage A (says "not same event"), should the cluster split or stay? Precision-vs-recall knob.
