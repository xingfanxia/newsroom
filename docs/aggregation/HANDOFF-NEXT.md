# Event aggregation — handoff after live deploy + agent surfacing (2026-04-25)

> **Read order**:
> 1. This file (current state + open optimization items)
> 2. `docs/aggregation/HANDOFF.md` (Wave 1-4 implementation handoff)
> 3. `docs/aggregation/DESIGN.md` / `PLAN.md` (original architecture)
> 4. `~/.claude/skills/ax-radar/SKILL.md` (agent-side glossary)

---

## Status: live in prod

Cross-source event aggregation has been deployed to production, the historical backfill ran successfully, all 4 stages are firing in the cron, and the agent-facing API/MCP/skill have been updated to surface events. The system is fully operational. This handoff exists because the operator wants to come back next session for a few targeted optimizations.

### Production state at handoff time

| Metric | Value |
|---|---|
| Total clusters | ~9050 |
| Multi-member events | 337 |
| Stage B verified | 337/337 (100%) |
| Stage C canonical-titled | 337/337 (100%) |
| Stage D event commentary | 170/171 featured-or-p1 events (99.4%) |
| `cluster_splits` audit rows | 50 |
| Max coverage | 10 sources (SpaceX/Cursor $60B story) |
| Cron schedule | `*/30 * * * *` |

The 1 stuck Stage D cluster is permanently blocked by Azure's content filter. It renders the lead-item commentary as fallback via the COALESCE read path.

---

## What shipped this session (post-PR-#13)

### Six PRs merged to main, in order

| # | Title | What it fixed |
|---|---|---|
| #13 | feat: cross-source event aggregation | Original 21-commit feature (Waves 1-4 + cron wiring + migration scripts + backtest harness + 3 code-review-driven fixes) |
| #15 | fix(cluster): rows-extraction cast | **CRITICAL** — Stage A was 100% no-op silently for the prior session. `(result as { rows?: unknown[] }).rows?.[0]` always returned `undefined` because postgres-js's `RowList<T>` extends `Array<T>` with no `.rows` field. Detection: post-merge backfill showed all clusters at member_count=1 despite backtest predicting 573 merges. |
| #16 | fix(cluster): delete zombie cluster row when claim loses race | Concurrent worker race left orphan cluster rows (member_count=0). 281 historical zombies cleaned up inline; future zombies prevented by deleting in failed-claim branch. |
| #17 | fix(arbitrate): `.nullable()` instead of `.optional()` for Azure strict mode | Stage B was 100% errors on first real run because Azure OpenAI's structured-output mode rejects schemas where any property is in `properties` but not in `required`. Switched `rejectedMemberIds` to `.nullable()`. |
| #18 | fix(feed): align calendar count with date-filter anchor | User-visible regression: clicking past date returned 0 even when calendar showed 172 items. Calendar bucketed on `items.published_at` but date filter bucketed on `COALESCE(cluster.first_seen_at, items.published_at)`. Fixed both to use `items.published_at` as the anchor (lead-item dedup means each event counts once). |
| #19 | feat(api,mcp): surface event aggregation in /api/v1 + MCP tools | Agent surface: `cluster_id` / `coverage` / `canonical_title` on feed + search results, new `event` block in items/[id], new `/api/v1/events/[id]/members` endpoint, new `ax_radar_event_members` MCP tool, MCP feed gets `view` + `hot_window_hours` params. |

Plus an out-of-tree update to `~/.claude/skills/ax-radar/SKILL.md` documenting the new event semantics + tool surface for agents.

### Backfill operations (one-time, on prod data)

1. `bunx drizzle-kit push --force` — schema additive (16 new columns, 4 indexes, 1 audit table)
2. `bun run db:hnsw` — rebuild HNSW (always required after drizzle-kit push)
3. `scripts/migrations/recluster-historical.ts` — destructive reset of clusters + Stage A loop on 9109 items, 47 min wall time, formed 358 multi-member clusters
4. `scripts/migrations/events-from-clusters.ts` — lifted editorial fields onto fresh clusters, recomputed importance with coverage boost, unioned HKR, nulled multi-member commentary_at so Stage D regenerates
5. Inline drain loops + production cron drained Stage B/C/D queues over ~90 minutes

---

## Known optimization items for next session

These are explicit, scoped follow-ups the operator flagged or that surfaced during deploy:

### 1. HNSW recall validation
**Concern**: `pgvector hnsw.ef_search` defaults to 40. The recluster ran with 40 and it found cluster 9115's nearest at distance 0.028 in our diagnostic query. But for items where the actual nearest is buried beyond the 40-candidate window, the lookup returns a further item and the merge is missed.

**Action**: instrument recall by, for a sample of 200 known-related pairs (the cluster_splits audit table is one source — pairs that Stage B *kept* are confirmed-related), check whether the worker's HNSW lookup actually returns each pair's partner as a candidate. If recall is below 95%, raise `hnsw.ef_search` to 100-200 in `db/client.ts` (set as a session-level `SET hnsw.ef_search = 100` in the transaction wrapper or per-query).

### 2. Stage B prompt tuning based on cluster_splits audit
**Concern**: 50 splits in the first day means the LLM rejected ~14% of multi-member clusters. Some of those splits are correct (over-merges from threshold=0.80), but some may be Haiku being too eager to split nuanced coverage. The audit trail lets us look back at split reasons and tune.

**Action**: query `SELECT cluster_id, item_id, reason, split_at FROM cluster_splits ORDER BY split_at DESC LIMIT 50;` and eyeball. If patterns emerge (e.g. "rejected because different angle on same event" — false split), tune the prompt's "When in doubt, KEEP" guidance with concrete examples.

### 3. Re-embedding with summaryEn augmentation (recall fallback)
**Concern**: cross-language pairs (zh source + en source covering same event) can fall outside the threshold because `title + summaryZh` embeddings put zh content closer to other zh content. The fallback in DESIGN.md is to re-embed with `title + summaryZh + summaryEn`.

**Action**: only worth it if hand-labeled recall (DESIGN.md §10) shows missed cross-language pairs. Generate a hand-labeled list of 20 known zh+en event pairs (template at `docs/reports/backtest-2026-04-24-full/hand-labeled-recall.md` exists but is empty). If recall < 80%, run a re-embed pass.

### 4. Admin UI for cluster operations
**Concern**: when the operator spots a wrong cluster (e.g. two unrelated events merged because they're both about "GPT-5"), there's no UI to merge/split — only raw SQL. DESIGN.md punted this until 3+ ops/week.

**Action**: deferred. Track via a manual log; if frequency hits 3/week, build a minimal admin page at `/admin/events` showing recent multi-member clusters with split/unmerge buttons.

### 5. Stage D Azure content-filter retry path
**Concern**: 1 cluster permanently blocked. Pattern will repeat for politically-sensitive topics.

**Action**: in `workers/cluster/commentary.ts`, catch the content-filter error specifically and retry with `reasoningEffort: "low"` or fall back to a different model (Gemini 3.x, or skip event-level commentary and use lead's). One-line addition.

### 6. `getFeaturedStories` per-source filter consistency
**Concern**: carryover from session 8 — `/x-monitor` and `/podcasts` use a fragile publisher-string client-side match. Now that `/api/v1/feed?source_id=` is exposed to agents, this needs to be airtight.

**Action**: audit any remaining publisher-string matches in `lib/items/live.ts` and replace with proper `source_id` filtering. Test with `?source_id=hn-frontpage` etc.

### 7. Backtest harness — write the recall-check sub-script
**Concern**: `docs/reports/backtest-2026-04-24-full/hand-labeled-recall.md` is a template. The "operator fills in pairs, then runs `scripts/ops/backtest-recall-check.ts`" loop is half-built — the first script generates the template; the second script doesn't exist.

**Action**: write `scripts/ops/backtest-recall-check.ts` that reads the markdown template, looks up each pair's distance + window-membership, reports merge-or-not under configurable threshold. ~80 LOC.

### 8. Cron schedule — increase from 30 min to 15 min?
**Concern**: cluster cron runs every 30 min. New events can take up to 30 min before the canonical title generates. For breaking news, that's a noticeable lag in the home feed.

**Action**: data-driven decision. Look at how often new items arrive (probably <5 per cron tick on average — the queue rarely has work). If the cron is mostly idle, drop to 15 min for fresher canonical titles + commentary. If it's already saturated, leave it.

---

## Operator runbook (in case anything needs re-running)

```bash
cd /Users/xingfanxia/projects/portfolio/newsroom-wt-aggregation/  # worktree

# Re-cluster historical (destructive; only if events look wrong)
bun --env-file=.env.local scripts/migrations/recluster-historical.ts --dry-run
bun --env-file=.env.local scripts/migrations/recluster-historical.ts

# Re-run migration (idempotent; re-running won't trample fresh Stage D)
bun --env-file=.env.local scripts/migrations/events-from-clusters.ts --dry-run
bun --env-file=.env.local scripts/migrations/events-from-clusters.ts

# Drain B/C/D queues locally (cron does this every 30 min naturally)
bun --env-file=.env.local -e "
import { runArbitrationBatch } from '@/workers/cluster/arbitrate';
import { runCanonicalTitleBatch } from '@/workers/cluster/canonical-title';
import { runEventCommentaryBatch } from '@/workers/cluster/commentary';
import { closeDb } from '@/db/client';
let iter = 0;
while (iter++ < 60) {
  const b = await runArbitrationBatch();
  const c = await runCanonicalTitleBatch();
  const d = await runEventCommentaryBatch();
  console.log(\`iter=\${iter} B=\${b.processed} C=\${c.processed} D=\${d.processed}\`);
  if (b.processed === 0 && c.processed === 0 && d.processed === 0) break;
}
await closeDb();
"

# Backtest under different thresholds
bun --env-file=.env.local scripts/ops/backtest-cluster.ts \
  --threshold 0.82 --since 2026-01-01 \
  --output docs/reports/backtest-tighter-threshold

# Live state poll
bun --env-file=.env.local -e "
import { db, closeDb } from './db/client.ts';
import { sql } from 'drizzle-orm';
const c = db();
const r = (await c.execute(sql\`
  SELECT
    (SELECT count(*) FROM clusters WHERE member_count >= 2)::int AS multi,
    (SELECT count(*) FROM clusters WHERE member_count >= 2 AND verified_at IS NOT NULL)::int AS verified,
    (SELECT count(*) FROM clusters WHERE member_count >= 2 AND canonical_title_zh IS NOT NULL)::int AS titled,
    (SELECT count(*) FROM clusters WHERE member_count >= 2 AND event_tier IN ('featured','p1') AND commentary_at IS NOT NULL)::int AS commented,
    (SELECT count(*) FROM clusters WHERE member_count >= 2 AND event_tier IN ('featured','p1'))::int AS eligible,
    (SELECT count(*) FROM cluster_splits)::int AS splits,
    (SELECT max(member_count) FROM clusters)::int AS max_coverage
\`));
console.log(JSON.stringify(r[0], null, 2));
await closeDb();
"
```

---

## Critical gotchas — DO NOT lose

1. **`as unknown as Array<T>`** is the right cast for `client.execute(sql\`...\`)` results. Never `(result as { rows?: unknown[] }).rows?.[0]` — that pattern was a silent killer before #15.

2. **Azure structured output requires `.nullable()` not `.optional()`** for any field that can be absent. Strict mode demands every property appears in `required`.

3. **`bun run db:hnsw` is mandatory after `drizzle-kit push`** — drizzle drops the HNSW index every time because it doesn't model pgvector operator classes.

4. **Calendar count + date filter MUST share the bucket anchor**. Both currently use `items.published_at` (post-#18). If one is changed to use cluster.first_seen_at, the other must change too — otherwise clicking a date returns the wrong items.

5. **Vercel env baked at deploy time** — `vercel env add` alone doesn't take effect; new commit + push triggers rebuild. The `ENABLE_EVENT_AGGREGATION` flag is currently *unused* by the code — the COALESCE read path provides kill-switch behavior at the SQL level. If you want belt-and-suspenders, gate the cluster cron in `app/api/cron/cluster/route.ts` on the env var.

6. **Cluster worker logs to console only** — no structured event log. For debugging Stage B verdicts in prod, query `cluster_splits` directly. Future: add structured logs to a `cluster_events` audit table if Stage B prompt tuning becomes a regular activity.

---

## Files quick-reference (all live in prod)

```
db/schema.ts                                 — extended clusters table, cluster_splits, items.cluster_verified_at
workers/cluster/index.ts                     — Stage A (post-#15 + #16 fixes)
workers/cluster/arbitrate.ts                 — Stage B (post-#17 nullable fix)
workers/cluster/canonical-title.ts           — Stage C
workers/cluster/commentary.ts                — Stage D
workers/cluster/importance.ts                — pure fns (recompute, approximate tier, union HKR)
workers/cluster/prompt.ts                    — combined B/C/D prompts
app/api/cron/cluster/route.ts                — chains A→B→C→D with safeStage isolation
app/api/v1/feed/route.ts                     — view + hot_window_hours params, cluster fields per item
app/api/v1/items/[id]/route.ts               — top-level event block when multi-member
app/api/v1/events/[id]/members/route.ts      — NEW Bearer-gated cross-source list
app/api/v1/search/route.ts                   — cluster fields on lexical + semantic results
app/api/mcp/route.ts                         — ax_radar_feed updated, ax_radar_event_members added
lib/items/live.ts                            — view-aware buildFeedWhere, items.publishedAt date anchor
lib/items/semantic-search.ts                 — cluster-aware dedup
lib/shell/dashboard-stats.ts                 — getDayCounts (post-#18 anchor fix)
lib/types.ts                                 — Story extensions
scripts/migrations/recluster-historical.ts   — one-time backfill (operator-driven)
scripts/migrations/events-from-clusters.ts   — idempotent migration (operator-driven)
scripts/ops/backtest-cluster.ts              — backtest harness
docs/aggregation/DESIGN.md                   — original architecture spec
docs/aggregation/PLAN.md                     — Wave breakdown
docs/aggregation/HANDOFF.md                  — Wave 1-4 implementation log
docs/aggregation/HANDOFF-NEXT.md             — THIS file
docs/reports/backtest-2026-04-24-full/       — full-window backtest results
~/.claude/skills/ax-radar/SKILL.md           — agent-side domain glossary (out-of-tree, in user home)
```

---

## Starting command for next session

Pick from the optimization items in §"Known optimization items for next session" above. Recommended priority order (fast → slow):

1. **Stage D content-filter retry** — 1-line fix, prevents future stuck clusters
2. **Stage B prompt audit** — eyeball `cluster_splits` for 10 minutes, decide if tune
3. **HNSW ef_search** — measure recall, raise to 100 if needed
4. **`getFeaturedStories` per-source filter audit** — durability for the API surface
5. **Cron 30→15 min** — depends on inbound volume; check first

Or, if the operator surfaces something else: this is the foundation. Cluster pipeline working, agent surface exposed, calendar fixed. Next session can drive any direction.
