# Cross-Source Event Aggregation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Fresh subagent per task, two-stage review (spec-compliance + quality) between tasks, parallel worktree dispatch in Waves 2 & 4.

**Goal:** Promote `clusters` to first-class editorial events with LLM-arbitrated membership, canonical titles, event-level commentary, coverage-boosted importance, and a two-view reader experience (trending-today + archive) — gated on offline backtest.

**Architecture:** Extend `clusters` table in place (aliased as `events` in TS), add Stage B/C/D workers inline with the existing cluster cron, rewrite `lib/items/live.ts` with `COALESCE(cluster.X, items.X)` fallback so singletons render unchanged and multi-member events pull from cluster. Ship behind `ENABLE_EVENT_AGGREGATION` env flag; gate cutover on backtest operator sign-off.

**Tech Stack:** TypeScript, Next.js (this project), drizzle-orm + Postgres 17 + pgvector halfvec, Azure OpenAI (text-embedding-3-large + Haiku for arbitration + existing enrich models), Vitest for unit/integration, Playwright for E2E, bun for runtime.

**Spec:** `docs/aggregation/DESIGN.md` (committed at a2a7a93). Read it before starting any task.

**Handoff context:** `docs/HANDOFF-AGGREGATION.md` (design seed; operational notes on HNSW index drop after `drizzle-kit push`).

---

## Pre-flight

### PF.1 — Sanity check environment

- [ ] **Verify dev environment**

Run: `bun --version && cat package.json | jq '.dependencies.drizzle-orm, .dependencies["drizzle-kit"], .dependencies.next'`
Expected: bun ≥ 1.0, drizzle-orm present, next present.

- [ ] **Verify DB connection**

Run: `bun run scripts/ops/db-ping.ts 2>/dev/null || bun -e 'import {db} from "./db/client"; const r = await db().execute(`SELECT count(*) FROM items`); console.log(r.rows)'`
Expected: numeric count of items (should be ~2900+).

- [ ] **Verify HNSW index health**

Run: `bun -e 'import {db} from "./db/client"; const r = await db().execute(`SELECT indexname FROM pg_indexes WHERE indexname LIKE E%hnsw%E`.replaceAll(/%/g, "%")); console.log(r.rows)'`

Simpler: `psql $DATABASE_URL -c "SELECT indexname FROM pg_indexes WHERE indexname LIKE '%hnsw%';"`
Expected: `items_embedding_hnsw_idx` present. If missing, run `bun run db:hnsw` before proceeding.

- [ ] **Confirm no active Next dev server on port 3009**

Run: `lsof -i :3009 | grep LISTEN || echo "port free"`
Expected: "port free". If something is listening, `kill -9 <pid>` or pick a different port for this session's dev runs.

---

## Wave 1 — Schema + Foundation (serial, single executor)

**Policy:** inline / main branch — mechanical schema + pure function. No subagent overhead.

### Task 1.1: Extend `db/schema.ts` with event-level columns + TS aliases

**Files:**
- Modify: `db/schema.ts` (clusters table definition + add events alias at end)

- [ ] **Step 1: Read current `db/schema.ts:220-232` (clusters definition)** to confirm current shape before editing.

- [ ] **Step 2: Replace the clusters definition (lines ~220-232) with the extended version:**

```ts
/**
 * clusters — groups of items covering the same real-world event.
 *
 * Extended 2026-04-24 (event-aggregation phase) to carry event-level
 * editorial fields — canonical titles, commentary, importance, tier —
 * lifted from items so a single event produces a single feed card and
 * a single commentary generation regardless of coverage count.
 *
 * TypeScript imports this same table as `events` (see alias below) for
 * semantic clarity in new code; the physical table name stays `clusters`
 * to preserve the existing `items.cluster_id` FK without a rename
 * migration.
 */
export const clusters = pgTable(
  "clusters",
  {
    id: serial("id").primaryKey(),
    /** Canonical lead item shown in the timeline. No FK constraint (circular dep). */
    leadItemId: integer("lead_item_id").notNull(),
    memberCount: integer("member_count").notNull().default(1),
    /** Inception — day the event broke. Archive anchor. */
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Last time a new member joined or Stage B rearbitrated. Trending-now anchor. */
    latestMemberAt: timestamp("latest_member_at", { withTimezone: true }),
    /** Cached coverage count — mirrors memberCount for now but kept
     *  distinct to leave room for future weighting (e.g. corroborating
     *  vs primary, if we ever add role annotation). */
    coverage: integer("coverage").notNull().default(1),
    // ── Canonical event name (Haiku-generated when member_count ≥ 2) ──
    canonicalTitleZh: text("canonical_title_zh"),
    canonicalTitleEn: text("canonical_title_en"),
    /** Last time canonical_title_* was regenerated. Used to throttle
     *  regen when membership grows slowly. */
    titledAt: timestamp("titled_at", { withTimezone: true }),
    // ── Event-level summaries (copied from lead on migration; regenerated on multi-member change) ──
    summaryZh: text("summary_zh"),
    summaryEn: text("summary_en"),
    // ── Event-level editorial commentary — replaces per-item fields for multi-member clusters ──
    editorNoteZh: text("editor_note_zh"),
    editorNoteEn: text("editor_note_en"),
    editorAnalysisZh: text("editor_analysis_zh"),
    editorAnalysisEn: text("editor_analysis_en"),
    commentaryAt: timestamp("commentary_at", { withTimezone: true }),
    // ── Event importance + tier (computed from members + coverage boost) ──
    importance: integer("importance"),
    /** featured | p1 | all | excluded — matches items.tier semantics but event-level. */
    eventTier: text("event_tier"),
    hkr: jsonb("hkr"),
    // ── Stage B verdict lock — prevents Stage A from reshuffling LLM-confirmed membership. ──
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    firstSeenIdx: index("clusters_first_seen_at_idx").on(t.firstSeenAt),
    latestMemberIdx: index("clusters_latest_member_at_idx").on(t.latestMemberAt),
    tierLatestIdx: index("clusters_tier_latest_idx").on(t.eventTier, t.latestMemberAt),
  }),
);
```

- [ ] **Step 3: Add `cluster_verified_at` column to `items` table definition:**

Locate the items table (around line 234 of current file). Add into the column block, after `clusteredAt`:

```ts
    clusterVerifiedAt: timestamp("cluster_verified_at", { withTimezone: true }),
```

And into the index block, add:

```ts
    clusterVerifiedIdx: index("items_cluster_verified_idx")
      .on(t.clusterVerifiedAt)
      .where(sql`${t.clusterVerifiedAt} IS NULL`),
```

- [ ] **Step 4: Add the new `clusterSplits` audit table** (after `iterationRuns` definition, before `apiTokens`):

```ts
/**
 * cluster_splits — audit trail for Stage B LLM arbitration verdicts.
 * One row per item that the arbitrator decided doesn't belong to the
 * cluster it was provisionally assigned to by Stage A embedding similarity.
 * Surviving members (those the arbitrator kept) are not logged here.
 *
 * Retained for weekly operator review + as future training signal for
 * prompt tuning.
 */
export const clusterSplits = pgTable(
  "cluster_splits",
  {
    id: serial("id").primaryKey(),
    itemId: integer("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    /** No FK — clusters can be GC'd; audit outlives them. */
    fromClusterId: integer("from_cluster_id").notNull(),
    /** Arbitrator's reason, ≤280 chars. Structured later if useful. */
    reason: text("reason").notNull(),
    splitAt: timestamp("split_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    recentIdx: index("cluster_splits_recent_idx").on(t.splitAt),
    itemIdx: index("cluster_splits_item_idx").on(t.itemId),
  }),
);
```

- [ ] **Step 5: Add type exports + `events` alias** at the bottom of the file (in the Types block, before `export type { TSourceKind, … }`):

```ts
// ── Event-aggregation aliases (clusters table repurposed as first-class events) ──
/** Semantic alias — clusters.ts represents "events" in the event-aggregation model.
 *  Physical table name is `clusters` for FK continuity with items.cluster_id. */
export const events = clusters;
export type Event = typeof clusters.$inferSelect;
export type NewEvent = typeof clusters.$inferInsert;
export type ClusterSplit = typeof clusterSplits.$inferSelect;
export type NewClusterSplit = typeof clusterSplits.$inferInsert;
```

- [ ] **Step 6: Type-check**

Run: `bun run typecheck` (or `npx tsc --noEmit`)
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add db/schema.ts
git commit -m "feat(db): extend clusters table with event-level fields + cluster_splits audit

Adds canonical titles, summaries, editor note/analysis, commentary_at,
importance, event_tier, hkr, coverage, latest_member_at, verified_at to
clusters. Adds cluster_verified_at to items as Stage B lock. Adds
cluster_splits audit table. Exports events/Event/NewEvent as aliases over
clusters to keep FK continuity while giving new code semantic names.

No data migration yet; columns are all nullable additions.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.2: Create `workers/cluster/importance.ts` pure-function module + unit test

**Files:**
- Create: `workers/cluster/importance.ts`
- Create: `workers/cluster/importance.test.ts`

- [ ] **Step 1: Write the failing test:**

```ts
// workers/cluster/importance.test.ts
import { describe, it, expect } from "vitest";
import { recomputeEventImportance, tierBucketFor } from "./importance";

describe("recomputeEventImportance", () => {
  it("returns base importance for singleton (coverage=1, log2(2)=1, boost=6)", () => {
    const r = recomputeEventImportance([{ importance: 60 }]);
    expect(r.importance).toBe(66);
    expect(r.coverage).toBe(1);
  });

  it("applies log2 coverage boost to the max member importance", () => {
    const r = recomputeEventImportance([
      { importance: 60 },
      { importance: 50 },
      { importance: 40 },
    ]);
    // base=60, coverage=3 → boost=round(log2(4)*6)=12, total=72
    expect(r.importance).toBe(72);
    expect(r.coverage).toBe(3);
  });

  it("caps final importance at 100", () => {
    const r = recomputeEventImportance(
      new Array(32).fill({ importance: 90 }),
    );
    // coverage=32 → boost=round(log2(33)*6)=round(30.28)=30, base+boost=120 → capped to 100
    expect(r.importance).toBe(100);
  });

  it("handles null importance on members by treating as 0", () => {
    const r = recomputeEventImportance([
      { importance: null },
      { importance: 40 },
    ]);
    // base=40, coverage=2 → boost=round(log2(3)*6)=round(9.51)=10, total=50
    expect(r.importance).toBe(50);
  });

  it("throws on empty member array", () => {
    expect(() => recomputeEventImportance([])).toThrow(/at least one member/i);
  });
});

describe("tierBucketFor", () => {
  it("maps importance to tier using existing scorer thresholds", () => {
    expect(tierBucketFor(95)).toBe("featured");
    expect(tierBucketFor(75)).toBe("p1");
    expect(tierBucketFor(45)).toBe("all");
    expect(tierBucketFor(10)).toBe("excluded");
  });

  it("boundaries match the scorer's intent (featured ≥ 80, p1 60-79, all 30-59, excluded < 30)", () => {
    expect(tierBucketFor(80)).toBe("featured");
    expect(tierBucketFor(79)).toBe("p1");
    expect(tierBucketFor(60)).toBe("p1");
    expect(tierBucketFor(59)).toBe("all");
    expect(tierBucketFor(30)).toBe("all");
    expect(tierBucketFor(29)).toBe("excluded");
  });
});
```

- [ ] **Step 2: Locate the scorer's actual tier thresholds**

Run: `grep -rn "featured\|excluded" workers/enrich/ lib/ | grep -iE "(tier|importance.*[0-9])" | head -20`

Read whichever file defines the tier ladder (likely `workers/enrich/scorer.ts` or `workers/enrich/prompt.ts`). Copy the exact thresholds into `tierBucketFor`. If the thresholds differ from the test's assumed (80/60/30), **update the test to match the existing thresholds**, not the other way around.

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test workers/cluster/importance.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Create the module:**

```ts
// workers/cluster/importance.ts
/**
 * Event-level importance + tier computation.
 *
 * Formula: final = min(max(member.importance) + round(log2(1 + coverage) * 6), 100)
 *
 * Rationale: coverage (number of covering sources) is the single best
 * editorial signal we have. A story with 8 covering sources IS more
 * important than the same story with 1 source. The log2 boost caps the
 * diminishing returns: 2 sources +6, 4 sources +12, 8 sources +18,
 * 16 sources +24, 32 sources +30.
 *
 * Tier thresholds match the per-item scorer (workers/enrich/scorer.ts) so
 * the event tier is directly comparable to member tiers.
 */

export type EventTier = "featured" | "p1" | "all" | "excluded";

export interface MemberImportanceInput {
  importance: number | null | undefined;
}

export interface EventImportanceResult {
  importance: number;
  tier: EventTier;
  coverage: number;
  base: number;
  boost: number;
}

export function recomputeEventImportance(
  members: MemberImportanceInput[],
): EventImportanceResult {
  if (members.length === 0) {
    throw new Error("recomputeEventImportance: at least one member required");
  }
  const base = Math.max(...members.map((m) => m.importance ?? 0));
  const coverage = members.length;
  const boost = Math.round(Math.log2(1 + coverage) * 6);
  const importance = Math.min(base + boost, 100);
  return {
    importance,
    tier: tierBucketFor(importance),
    coverage,
    base,
    boost,
  };
}

/**
 * Match the per-item scorer's tier thresholds. If the scorer's ladder
 * changes, update BOTH this function and workers/enrich/scorer.ts in lockstep.
 *
 * Current thresholds (as of 2026-04-24):
 *   featured: >= 80   (breaking, high-impact)
 *   p1:       60-79   (meaningful, must-read-today)
 *   all:      30-59   (worth browsing, below-the-fold)
 *   excluded: < 30    (noise)
 */
export function tierBucketFor(importance: number): EventTier {
  if (importance >= 80) return "featured";
  if (importance >= 60) return "p1";
  if (importance >= 30) return "all";
  return "excluded";
}
```

If the scorer's actual thresholds differ from the ones above, adjust and update the test.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test workers/cluster/importance.test.ts`
Expected: PASS (all 7+ cases).

- [ ] **Step 6: Commit**

```bash
git add workers/cluster/importance.ts workers/cluster/importance.test.ts
git commit -m "feat(cluster): event importance + tier pure function with coverage boost

Implements: final = min(max(member.importance) + round(log2(1+coverage)*6), 100)
Tier thresholds mirror workers/enrich/scorer.ts. Pure, unit-tested.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.3: Apply schema to DB + restore HNSW index

- [ ] **Step 1: Review pending schema changes**

Run: `bun run db:generate 2>/dev/null || bunx drizzle-kit generate`
(If the project uses `push` not `generate`, skip this and the diff will be visible in step 2.)

- [ ] **Step 2: Apply schema with explicit confirmation**

Run: `bunx drizzle-kit push`
If prompted about data loss or non-trivial changes, read the diff carefully. All new columns are nullable ADDs; no existing data should be affected. Confirm to apply. If any prompt suggests destructive changes on items/clusters existing columns, STOP and investigate before proceeding.

- [ ] **Step 3: Restore HNSW index** (critical — `drizzle-kit push` drops it every time per handoff operational note)

Run: `bun run db:hnsw`
Expected: "HNSW index created on items.embedding" or similar success message.

Verify: `psql $DATABASE_URL -c "SELECT indexname FROM pg_indexes WHERE tablename='items' AND indexname LIKE '%hnsw%';"`
Expected: `items_embedding_hnsw_idx` present.

- [ ] **Step 4: Verify new schema landed**

Run:
```bash
psql $DATABASE_URL <<'SQL'
\d clusters
\d cluster_splits
SELECT column_name FROM information_schema.columns
WHERE table_name='items' AND column_name='cluster_verified_at';
SQL
```

Expected: new columns visible on clusters (canonical_title_*, latest_member_at, etc.), cluster_splits table exists, items.cluster_verified_at exists.

- [ ] **Step 5: Sanity — existing feed still works**

Run: `bun run dev` in a background shell, `curl -s http://localhost:3009/api/v1/feed?limit=5 | jq '.items | length'`
Expected: 5.

Stop dev server.

- [ ] **Step 6: Commit (schema + db:hnsw idempotent; nothing to stage unless drizzle wrote migration files)**

```bash
git status
# If drizzle wrote files in db/migrations/ or similar:
git add db/migrations/
git commit -m "chore(db): apply cluster event-level schema + restore HNSW

Schema extension from Task 1.1 applied via drizzle-kit push. HNSW index
restored via scripts/ops/db-create-hnsw.ts (drizzle-kit push drops it
every time — documented in docs/HANDOFF-AGGREGATION.md operational notes).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

If no files to stage, skip the commit step.

---

## Wave 2 — Workers (parallel × 4 worktrees)

**Policy:** `parallel-worktree`. Each worktree owns one new worker file + its test. The Stage A worker (2a) also modifies `workers/cluster/index.ts`, so worktree 2a owns that file; other worktrees are new-file-only to avoid conflicts.

**Required sub-skill for this wave:** `superpowers:using-git-worktrees` (load it before setup).

### Task 2.0: Set up worktrees

- [ ] **Step 1: From the newsroom repo root, create 4 worktrees:**

```bash
git worktree add ../newsroom-wt-stage-a -b feat/aggregation-stage-a
git worktree add ../newsroom-wt-stage-b -b feat/aggregation-stage-b
git worktree add ../newsroom-wt-stage-c -b feat/aggregation-stage-c
git worktree add ../newsroom-wt-stage-d -b feat/aggregation-stage-d
```

- [ ] **Step 2: Verify each worktree has node_modules (or install)**

```bash
for wt in stage-a stage-b stage-c stage-d; do
  (cd ../newsroom-wt-$wt && [ -d node_modules ] && echo "$wt: ok" || { echo "$wt: installing"; bun install; })
done
```

- [ ] **Step 3: Dispatch 4 parallel subagents**, one per worktree. Each subagent receives: path to worktree, path to DESIGN.md, path to this PLAN.md, and the specific task ID (2a, 2b, 2c, 2d) to execute. Subagent contract per `superpowers:subagent-driven-development`:
  - Load inputs from disk (don't ask the orchestrator)
  - Implement the task fully with TDD
  - Run build + typecheck + unit tests in the worktree
  - Return `{task_id, status: FIXED|BLOCKED, files_touched, commit_sha, test_summary}` ≤ 200 tokens
  - Do NOT merge back to main; orchestrator handles that in Task 2.M

---

### Task 2.a (worktree: stage-a): Tune `workers/cluster/index.ts`

**Owner:** worktree `newsroom-wt-stage-a`
**Files:**
- Modify: `workers/cluster/index.ts`
- Create: `workers/cluster/index.test.ts` (if not present)

- [ ] **Step 1: Write integration test for published-anchor window + verified-skip:**

```ts
// workers/cluster/index.test.ts
// Integration-style — uses a real test DB or a transactional fixture.
// If the project uses PGlite or similar, wire through it; otherwise use
// a DATABASE_URL pointing at a disposable test DB.

import { describe, it, expect, beforeEach } from "vitest";
import { runClusterBatch } from "./index";
import { setupTestDB, seedItem } from "../../tests/helpers/db";

describe("runClusterBatch — tuned window + verified-skip", () => {
  beforeEach(setupTestDB);

  it("clusters items published within ±72h of each other", async () => {
    const now = new Date("2026-04-20T12:00:00Z");
    // item A: 2026-04-20 12:00
    // item B: 2026-04-18 13:00 (47h before A)
    // item C: 2026-04-17 10:00 (74h before A → should NOT cluster)
    const a = await seedItem({ publishedAt: now, embedding: sharedEmbedding() });
    const b = await seedItem({
      publishedAt: new Date(now.getTime() - 47 * 3600_000),
      embedding: sharedEmbedding(),
    });
    const c = await seedItem({
      publishedAt: new Date(now.getTime() - 74 * 3600_000),
      embedding: sharedEmbedding(),
    });

    await runClusterBatch();

    // a and b should share a cluster; c should be a singleton.
    const rows = await fetchItemClusterIds([a, b, c]);
    expect(rows[a]).toBe(rows[b]);
    expect(rows[a]).not.toBe(rows[c]);
  });

  it("skips items with cluster_verified_at set (Stage B lock)", async () => {
    // Seed a verified item with an embedding; seed a new nearby item.
    // Expect: new item goes to a new cluster, not the verified one.
    // (Full test body — follow the first test's pattern.)
  });

  it("uses threshold 0.80 not 0.88", async () => {
    // Seed two items whose cosine similarity is 0.82.
    // Expect: they cluster (would NOT have under 0.88).
  });
});

function sharedEmbedding() { /* return a fixed 3072-dim halfvec, identical across items */ }
```

If the project doesn't have `tests/helpers/db.ts`, create a minimal one or write this as a manual "docs/reports/wave2-smoke.md" verification instead of a vitest integration. Prefer the vitest route if feasible.

- [ ] **Step 2: Run test to verify it fails (threshold unchanged, window anchored to now())**

Run: `bun test workers/cluster/index.test.ts`
Expected: FAIL on the threshold test (current 0.88 won't cluster 0.82-similar items).

- [ ] **Step 3: Apply the three tuning changes to `workers/cluster/index.ts`:**

Change 1 (lines 6-7):

```ts
// Before:
const SIMILARITY_THRESHOLD = 0.88;
const WINDOW_HOURS = 48;
// After:
const SIMILARITY_THRESHOLD = 0.80;
const WINDOW_HOURS = 72;
```

Change 2 (around line 100, inside `assignOneToCluster`): rewrite the window WHERE clause to published-anchor:

```sql
-- Before (current):
AND i.published_at > now() - make_interval(hours => ${WINDOW_HOURS})

-- After:
AND i.published_at BETWEEN
    (SELECT published_at FROM items WHERE id = ${itemId}) - make_interval(hours => ${WINDOW_HOURS})
    AND
    (SELECT published_at FROM items WHERE id = ${itemId}) + make_interval(hours => ${WINDOW_HOURS})
AND i.cluster_verified_at IS NULL
```

Full updated `nearestResult` query:

```ts
const nearestResult = await client.execute(sql`
  WITH target AS (
    SELECT embedding, published_at FROM items WHERE id = ${itemId}
  )
  SELECT
    i.id,
    i.cluster_id,
    i.clustered_at,
    (i.embedding <=> (SELECT embedding FROM target)) AS distance
  FROM items i
  WHERE i.id <> ${itemId}
    AND i.embedding IS NOT NULL
    AND i.enriched_at IS NOT NULL
    AND i.cluster_verified_at IS NULL
    AND i.published_at BETWEEN
        (SELECT published_at FROM target) - make_interval(hours => ${WINDOW_HOURS})
        AND
        (SELECT published_at FROM target) + make_interval(hours => ${WINDOW_HOURS})
  ORDER BY i.embedding <=> (SELECT embedding FROM target)
  LIMIT 1
`);
```

Change 3: after each successful cluster update (at the end of `assignOneToCluster`), also update `clusters.latest_member_at`:

```ts
// After the existing `update(clusters).set({ memberCount: ... })`:
await client
  .update(clusters)
  .set({
    memberCount: sql`${clusters.memberCount} + 1`,
    coverage: sql`${clusters.memberCount} + 1`,      // keep in lockstep for now
    latestMemberAt: new Date(),
    updatedAt: new Date(),
  })
  .where(sql`${clusters.id} = ${clusterId}`);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test workers/cluster/index.test.ts`
Expected: PASS on all three cases.

- [ ] **Step 5: Run the full test suite (don't regress anything else)**

Run: `bun test`
Expected: green.

- [ ] **Step 6: Commit in the stage-a worktree**

```bash
git add workers/cluster/index.ts workers/cluster/index.test.ts
git commit -m "feat(cluster): tune Stage A — threshold 0.80, ±72h published-anchor window, skip verified

- SIMILARITY_THRESHOLD 0.88 → 0.80 (wider recall; Stage B filters precision)
- WINDOW_HOURS 48 → 72
- Window anchor: now() → target item's published_at (bidirectional ±)
  Fixes backfill case where late-arriving items with old publishedAt
  couldn't find their temporal cohort.
- Skip items with cluster_verified_at IS NOT NULL (Stage B lock)
- Maintain latest_member_at on every member join

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.b (worktree: stage-b): Create `workers/cluster/arbitrate.ts` (Stage B LLM arbitrator)

**Owner:** worktree `newsroom-wt-stage-b`
**Files:**
- Create: `workers/cluster/arbitrate.ts`
- Create: `workers/cluster/arbitrate.test.ts`
- Create: `workers/cluster/prompt.ts` (shared prompts for Stage B + Stage C; Task 2.c will also contribute)

- [ ] **Step 1: Create shared prompt file (initial Stage B portion only):**

```ts
// workers/cluster/prompt.ts
/**
 * Shared prompts for cluster-stage LLM calls:
 *   Stage B (arbitrate): given a candidate cluster's members, decide keep-or-split
 *   Stage C (canonical-title): generate neutral canonical title for a confirmed event
 */

export const arbitrateSystem = `You are an editorial gatekeeper for a real-time AI news aggregator.

Your job: given a group of articles that an embedding-similarity algorithm grouped together, decide whether they all cover the SAME real-world event, or whether some should be split out.

Rules:
- "Same event" means: a single concrete happening in the world (a product release, a paper drop, a company announcement, a policy decision, a specific incident). Not a theme, not a topic, not a vibe.
- Coverage of the same event from different angles (official announcement + analysis + reaction) IS the same event. KEEP those grouped.
- Articles about the same company / person / technology but DIFFERENT specific events are NOT the same event. SPLIT them.
- When in doubt, KEEP. The goal is deduping redundant coverage; over-splitting defeats the purpose.

Output JSON: { verdict: "keep" | "split", rejectedMemberIds?: number[], reason: string }
- "keep": all members are the same event
- "split": rejectedMemberIds is the subset that should be moved out; the remainder stays
- reason: ≤ 280 chars, plain language, audit-grade. Cite specific titles when relevant.`;

export function arbitrateUserPrompt(input: {
  clusterId: number;
  members: Array<{
    itemId: number;
    titleZh: string | null;
    titleEn: string | null;
    rawTitle: string;
    publishedAt: string;
    sourceName: string;
  }>;
  leadSummary: string | null;
}): string {
  const memberLines = input.members
    .map(
      (m) =>
        `[id=${m.itemId}] ${m.sourceName} @ ${m.publishedAt}\n  zh: ${m.titleZh ?? "(none)"}\n  en: ${m.titleEn ?? "(none)"}\n  raw: ${m.rawTitle}`,
    )
    .join("\n\n");

  return `Cluster #${input.clusterId}

Lead summary:
${input.leadSummary ?? "(no summary available)"}

Members (${input.members.length}):
${memberLines}

Decide keep vs split. Emit structured JSON only.`;
}
```

- [ ] **Step 2: Write failing tests for the arbitrator:**

```ts
// workers/cluster/arbitrate.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { runArbitrationBatch } from "./arbitrate";
import { setupTestDB, seedItem, seedCluster, setClusterMembers } from "../../tests/helpers/db";

// Mock the LLM layer
vi.mock("@/lib/llm", async () => {
  const actual = await vi.importActual<typeof import("@/lib/llm")>("@/lib/llm");
  return {
    ...actual,
    generateStructured: vi.fn(),
  };
});

import { generateStructured } from "@/lib/llm";

describe("runArbitrationBatch", () => {
  beforeEach(async () => {
    await setupTestDB();
    vi.mocked(generateStructured).mockReset();
  });

  it("sets verified_at on a 'keep' verdict and locks all members", async () => {
    const [i1, i2] = await Promise.all([seedItem(), seedItem()]);
    const c = await seedCluster({ leadItemId: i1, memberCount: 2 });
    await setClusterMembers(c, [i1, i2]);

    vi.mocked(generateStructured).mockResolvedValueOnce({
      data: { verdict: "keep", reason: "All three cover OpenAI's GPT-5.5 release" },
      // ... whatever other shape the real return has
    } as never);

    const report = await runArbitrationBatch();

    expect(report.keptClusters).toBe(1);
    const cluster = await fetchCluster(c);
    expect(cluster.verifiedAt).toBeInstanceOf(Date);
    const items = await fetchItems([i1, i2]);
    expect(items[0].clusterVerifiedAt).toBeInstanceOf(Date);
    expect(items[1].clusterVerifiedAt).toBeInstanceOf(Date);
  });

  it("unlinks rejected members and writes cluster_splits rows on 'split'", async () => {
    const [i1, i2, i3] = await Promise.all([seedItem(), seedItem(), seedItem()]);
    const c = await seedCluster({ leadItemId: i1, memberCount: 3 });
    await setClusterMembers(c, [i1, i2, i3]);

    vi.mocked(generateStructured).mockResolvedValueOnce({
      data: {
        verdict: "split",
        rejectedMemberIds: [i3],
        reason: "i3 is about GPT-5 (2024), not GPT-5.5",
      },
    } as never);

    await runArbitrationBatch();

    const items = await fetchItems([i1, i2, i3]);
    expect(items[0].clusterId).toBe(c);
    expect(items[1].clusterId).toBe(c);
    expect(items[2].clusterId).toBeNull();
    expect(items[2].clusteredAt).toBeNull();
    const splits = await fetchSplits();
    expect(splits).toContainEqual(
      expect.objectContaining({ itemId: i3, fromClusterId: c }),
    );
  });

  it("respects MAX_ARBITRATIONS_PER_RUN budget cap", async () => {
    // Seed 20 unverified clusters with ≥2 members each.
    // Expect: at most 15 LLM calls made.
    // (Full body — follow the pattern above.)
  });

  it("skips clusters already verified with no new unverified members", async () => {
    // Cluster with verified_at set and all members.cluster_verified_at set
    // should not trigger arbitration.
  });

  it("re-arbitrates when a new unverified member joined a previously-verified cluster", async () => {
    // Cluster verified_at set, but one member has cluster_verified_at=NULL
    // Expect: arbitrator runs on this cluster.
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test workers/cluster/arbitrate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Create the arbitrator module** at `workers/cluster/arbitrate.ts`:

Target interface:

```ts
export const MAX_ARBITRATIONS_PER_RUN = 15;

export type ArbitrationVerdict = {
  verdict: "keep" | "split";
  rejectedMemberIds?: number[];
  reason: string;
};

export type ArbitrationReport = {
  processed: number;
  keptClusters: number;
  splitClusters: number;
  itemsMoved: number;
  durationMs: number;
  errors: Array<{ clusterId: number; reason: string }>;
};

export async function runArbitrationBatch(): Promise<ArbitrationReport>;
```

Implementation skeleton (fill in to pass tests + pattern-match `workers/enrich/index.ts`'s error handling and LLM call style):

1. Select candidate clusters via a single SQL:
   ```sql
   SELECT c.id, c.lead_item_id FROM clusters c
   WHERE c.member_count >= 2
     AND (
       c.verified_at IS NULL
       OR EXISTS (
         SELECT 1 FROM items i
         WHERE i.cluster_id = c.id AND i.cluster_verified_at IS NULL
       )
     )
   ORDER BY c.member_count DESC, c.updated_at DESC
   LIMIT $MAX_ARBITRATIONS_PER_RUN
   ```

2. For each candidate, load all members (items + their titles + sourceName join).

3. Build prompt via `arbitrateUserPrompt`.

4. Call `generateStructured` with Haiku (look at existing task='enrich' call for pattern; use `task='arbitrate'` for the llm_usage ledger).

5. Apply verdict in a transaction:
   - `keep`: `UPDATE clusters SET verified_at = NOW()` + `UPDATE items SET cluster_verified_at = NOW() WHERE cluster_id = $c AND cluster_verified_at IS NULL`
   - `split`: loop rejected IDs → `UPDATE items SET cluster_id = NULL, clustered_at = NULL, cluster_verified_at = NULL` + `INSERT INTO cluster_splits` + `UPDATE clusters SET member_count = member_count - N`. Then verify the survivors (`verified_at = NOW()` on the cluster; `cluster_verified_at = NOW()` on surviving items).
   - Recompute importance + tier for the (possibly shrunken) cluster via `recomputeEventImportance` from Task 1.2.

6. Track `processed`, `keptClusters`, `splitClusters`, `itemsMoved`, `errors` for the return report.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test workers/cluster/arbitrate.test.ts`
Expected: PASS on all cases. Fix implementation iteratively until green.

- [ ] **Step 6: Run full test suite**

Run: `bun test`
Expected: green.

- [ ] **Step 7: Commit in stage-b worktree**

```bash
git add workers/cluster/arbitrate.ts workers/cluster/arbitrate.test.ts workers/cluster/prompt.ts
git commit -m "feat(cluster): Stage B LLM arbitrator for event membership

Haiku inspects embedding-clustered members and decides keep-or-split.
On split, rejected members get unlinked + logged to cluster_splits.
On keep, cluster.verified_at + items.cluster_verified_at lock the
assignment from future Stage A reshuffling.

Budget-capped at 15 arbitrations per cron run.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.c (worktree: stage-c): Create `workers/cluster/canonical-title.ts`

**Owner:** worktree `newsroom-wt-stage-c`
**Files:**
- Create: `workers/cluster/canonical-title.ts`
- Create: `workers/cluster/canonical-title.test.ts`
- Modify: `workers/cluster/prompt.ts` (add canonical-title prompt; merge-conflict-resolve with Task 2.b at Task 2.M)

- [ ] **Step 1: Append to `workers/cluster/prompt.ts`:**

```ts
export const canonicalTitleSystem = `You name real-world events for a neutral AI news aggregator.

Input: multiple article titles (bilingual zh/en) covering the same event, plus a lead summary.
Output: one canonical title per locale — 8-14 words in English, 8-14 Chinese characters — that a reader would use to REFER to this event in conversation.

Rules:
- Neutral tone. No marketing copy ("BREAKING", "MUST READ", "INSANE").
- No editorializing. Describe what happened, not how to feel about it.
- Locale-native. The zh title should read like natural Chinese, not a literal translation of the en title. Same the other way.
- No quotes, no emoji, no trailing punctuation.
- If the members disagree on what the event IS, pick the narrowest concrete event they share.

Output JSON: { canonicalTitleZh: string, canonicalTitleEn: string }`;

export function canonicalTitleUserPrompt(input: {
  memberTitles: Array<{ zh: string | null; en: string | null; source: string }>;
  leadSummaryZh: string | null;
  leadSummaryEn: string | null;
}): string {
  const titleLines = input.memberTitles
    .map((t, i) => `${i + 1}. [${t.source}]\n   zh: ${t.zh ?? "(none)"}\n   en: ${t.en ?? "(none)"}`)
    .join("\n");

  return `Member titles (${input.memberTitles.length} sources):
${titleLines}

Lead summary (zh): ${input.leadSummaryZh ?? "(none)"}
Lead summary (en): ${input.leadSummaryEn ?? "(none)"}

Emit { canonicalTitleZh, canonicalTitleEn } JSON only.`;
}
```

- [ ] **Step 2: Write failing tests for canonical-title generator:**

```ts
// workers/cluster/canonical-title.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { runCanonicalTitleBatch } from "./canonical-title";
import { setupTestDB, seedItem, seedCluster, setClusterMembers } from "../../tests/helpers/db";

vi.mock("@/lib/llm", async () => {
  const actual = await vi.importActual<typeof import("@/lib/llm")>("@/lib/llm");
  return { ...actual, generateStructured: vi.fn() };
});

import { generateStructured } from "@/lib/llm";

describe("runCanonicalTitleBatch", () => {
  beforeEach(async () => {
    await setupTestDB();
    vi.mocked(generateStructured).mockReset();
  });

  it("generates title for member_count ≥ 2 clusters without canonical_title_zh", async () => {
    const [i1, i2] = await Promise.all([
      seedItem({ titleZh: "OpenAI 发布 GPT-5.5", titleEn: "OpenAI releases GPT-5.5" }),
      seedItem({ titleZh: "GPT-5.5 性能评测", titleEn: "GPT-5.5 performance review" }),
    ]);
    const c = await seedCluster({ leadItemId: i1, memberCount: 2 });
    await setClusterMembers(c, [i1, i2]);

    vi.mocked(generateStructured).mockResolvedValueOnce({
      data: { canonicalTitleZh: "OpenAI 发布 GPT-5.5", canonicalTitleEn: "OpenAI launches GPT-5.5" },
    } as never);

    await runCanonicalTitleBatch();
    const cluster = await fetchCluster(c);
    expect(cluster.canonicalTitleZh).toBe("OpenAI 发布 GPT-5.5");
    expect(cluster.canonicalTitleEn).toBe("OpenAI launches GPT-5.5");
    expect(cluster.titledAt).toBeInstanceOf(Date);
  });

  it("skips singletons (member_count = 1)", async () => {
    const i1 = await seedItem();
    const c = await seedCluster({ leadItemId: i1, memberCount: 1 });
    await setClusterMembers(c, [i1]);

    await runCanonicalTitleBatch();
    const cluster = await fetchCluster(c);
    expect(cluster.canonicalTitleZh).toBeNull();
    expect(vi.mocked(generateStructured)).not.toHaveBeenCalled();
  });

  it("regenerates when member_count grew by ≥2 since titled_at", async () => {
    // Seed cluster with titled_at set, memberCount=4, old canonicalTitle.
    // Add 2 more members (update memberCount to 6 without touching titled_at).
    // Expect: regeneration happens.
  });

  it("does not regenerate on +1 member change (throttle)", async () => {
    // Cluster with titled_at set, memberCount 3. Add 1 member → memberCount=4.
    // Expect: skip, no LLM call.
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `bun test workers/cluster/canonical-title.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the module** with interface:

```ts
export type CanonicalTitleReport = {
  processed: number;
  generated: number;
  skipped: number;
  durationMs: number;
  errors: Array<{ clusterId: number; reason: string }>;
};

export const MAX_TITLES_PER_RUN = 15;

export async function runCanonicalTitleBatch(): Promise<CanonicalTitleReport>;
```

Candidate query:

```sql
SELECT c.id, c.member_count, c.lead_item_id
FROM clusters c
WHERE c.member_count >= 2
  AND (
    c.canonical_title_zh IS NULL
    OR (c.member_count - (
      SELECT COUNT(*) FROM items WHERE cluster_id = c.id
        AND clustered_at < c.titled_at
    )) >= 2
  )
ORDER BY c.member_count DESC, c.updated_at DESC
LIMIT $MAX_TITLES_PER_RUN
```

(The subquery approximates "members added since titled_at"; exact implementation may simplify if tested against real data.)

Implementation loops candidates, loads member titles (items JOIN sources to get nameZh/nameEn), builds prompt via `canonicalTitleUserPrompt`, calls Haiku, writes `canonicalTitleZh`, `canonicalTitleEn`, `titledAt` on the cluster.

Use `task='canonical-title'` in the LLM call for ledger accounting.

- [ ] **Step 5: Run to verify pass**

Run: `bun test workers/cluster/canonical-title.test.ts`
Expected: PASS.

- [ ] **Step 6: Run full suite**

Run: `bun test`
Expected: green.

- [ ] **Step 7: Commit in stage-c worktree**

```bash
git add workers/cluster/canonical-title.ts workers/cluster/canonical-title.test.ts workers/cluster/prompt.ts
git commit -m "feat(cluster): Stage C — Haiku canonical title generation for events

Generates neutral canonical_title_zh + canonical_title_en for clusters
with member_count ≥ 2. Skips singletons. Regenerates on member_count
growth ≥ 2 or Stage B reshuffle (trigger via titled_at comparison).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.d (worktree: stage-d): Refactor commentary to event-level — `workers/cluster/commentary.ts`

**Owner:** worktree `newsroom-wt-stage-d`
**Files:**
- Create: `workers/cluster/commentary.ts` (lifted from `workers/enrich/commentary.ts`, input = event not item)
- Create: `workers/cluster/commentary.test.ts`
- Modify: `workers/enrich/commentary.ts` (no longer runs for items-that-will-cluster; becomes singleton-only)

- [ ] **Step 1: Read current `workers/enrich/commentary.ts`** to understand the existing prompt + LLM shape.

- [ ] **Step 2: Create `workers/cluster/commentary.ts`** as an event-level version:

Interface:

```ts
export type EventCommentaryReport = {
  processed: number;
  generated: number;
  durationMs: number;
  errors: Array<{ clusterId: number; reason: string }>;
};

export const MAX_EVENT_COMMENTARY_PER_RUN = 8;  // expensive; lower cap than Stage C

export async function runEventCommentaryBatch(): Promise<EventCommentaryReport>;
```

Candidate query — clusters where `event_tier IN ('featured', 'p1')` AND `commentary_at IS NULL`:

```sql
SELECT c.id, c.lead_item_id, c.canonical_title_zh, c.canonical_title_en
FROM clusters c
WHERE c.event_tier IN ('featured', 'p1')
  AND c.commentary_at IS NULL
ORDER BY c.importance DESC NULLS LAST, c.updated_at DESC
LIMIT $MAX_EVENT_COMMENTARY_PER_RUN
```

For each candidate:
1. Load all member titles + source names.
2. Load the richest member's `body_md` (pick the member with longest `body_md`, truncate to 8000 chars).
3. Build the prompt. Reuse the existing commentary prompt style from `workers/enrich/commentary.ts`, but the "this story" singular becomes "this event" plural, with the member breakdown surfaced. Move the base prompt into `workers/cluster/prompt.ts` as `eventCommentarySystem` + `eventCommentaryUserPrompt`.
4. Call the LLM with the same model+profile `workers/enrich/commentary.ts` uses today (pattern match). Use `task='event-commentary'` in the ledger.
5. Write `editor_note_zh/en` + `editor_analysis_zh/en` + `commentary_at = NOW()` to the cluster.

- [ ] **Step 3: Write unit tests for `runEventCommentaryBatch`:**

```ts
// workers/cluster/commentary.test.ts
// Pattern-match the arbitrate.test.ts style: mock LLM, seed DB, assert writes.
// Test cases:
//   1. Generates commentary for a featured multi-member cluster with commentary_at=NULL
//   2. Skips singletons (even if tier=featured)? No — singletons get commentary via enrich still.
//      Actually: singletons also live in clusters (memberCount=1). After migration, the cluster
//      has commentary already. We want this batch to skip memberCount=1 clusters (their commentary
//      came from enrich). So: add WHERE member_count >= 2 to the candidate query.
//   3. Respects MAX_EVENT_COMMENTARY_PER_RUN cap
//   4. Does not run twice on the same event (commentary_at IS NULL is the idempotency guard)
```

**Update candidate query to include `AND c.member_count >= 2`** — singletons get per-item commentary via `workers/enrich/commentary.ts` (unchanged for them).

- [ ] **Step 4: Modify `workers/enrich/commentary.ts`** so it skips items destined to cluster:

Look at the current commentary trigger logic. Add a guard: if the item's cluster has `member_count >= 2`, skip item-level commentary (the cluster worker will handle it). Alternative cleaner guard: gate on `items.cluster_id IS NULL OR (cluster.member_count = 1)`. Pattern-match the existing query shape.

Don't delete the per-item commentary path — singletons still need it. Only skip the item-level call for items that are already in a multi-member cluster.

- [ ] **Step 5: Run tests to verify pass**

Run: `bun test workers/cluster/commentary.test.ts workers/enrich/commentary.test.ts`
Expected: PASS (existing tests on enrich side must not regress).

- [ ] **Step 6: Full suite**

Run: `bun test`

- [ ] **Step 7: Commit in stage-d worktree**

```bash
git add workers/cluster/commentary.ts workers/cluster/commentary.test.ts workers/cluster/prompt.ts workers/enrich/commentary.ts
git commit -m "feat(cluster): Stage D — event-level commentary worker

Lifts editor-note/analysis generation from per-item to per-event for
multi-member clusters. workers/enrich/commentary.ts now skips items
that belong to a cluster with member_count >= 2 — cluster worker picks
them up instead. Singletons (member_count = 1) unchanged.

Expected impact: 5-10x reduction in commentary generation volume on
active news days per design spec (§6.4).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.M: Merge worktrees back to main

**Owner:** main-thread orchestrator. Subagents hand back `{commit_sha, files_touched}`.

- [ ] **Step 1: From newsroom root, verify all 4 subagents completed**

```bash
for wt in stage-a stage-b stage-c stage-d; do
  echo "=== $wt ==="
  (cd ../newsroom-wt-$wt && git log -1 --oneline)
done
```

Expected: 4 commits, one per worktree, all on feat/aggregation-stage-* branches.

- [ ] **Step 2: Merge in order (resolve `prompt.ts` conflict between 2.b and 2.c + 2.d)**

```bash
# stage-a first (modifies workers/cluster/index.ts, no overlap with prompt.ts)
git merge --no-ff feat/aggregation-stage-a -m "Merge Stage A tuning"

# stage-b next (creates prompt.ts with arbitrate prompts)
git merge --no-ff feat/aggregation-stage-b -m "Merge Stage B arbitrator"

# stage-c (appends canonical-title prompts to prompt.ts — expect conflict on the ADD)
git merge --no-ff feat/aggregation-stage-c
# If conflict: the "both added" case is resolved by taking stage-b's content + appending stage-c's additions. Manual merge of prompt.ts; other files clean.
git add workers/cluster/prompt.ts
git commit --no-edit

# stage-d (appends event-commentary prompts + modifies enrich/commentary.ts)
git merge --no-ff feat/aggregation-stage-d
# If conflict in prompt.ts: same pattern — concatenate all prompt exports.
git add workers/cluster/prompt.ts
git commit --no-edit
```

- [ ] **Step 3: Run full test suite on merged main**

```bash
bun test
bun run typecheck
```

Expected: all green.

- [ ] **Step 4: Clean up worktrees**

```bash
git worktree remove ../newsroom-wt-stage-a
git worktree remove ../newsroom-wt-stage-b
git worktree remove ../newsroom-wt-stage-c
git worktree remove ../newsroom-wt-stage-d
git branch -d feat/aggregation-stage-{a,b,c,d}
```

- [ ] **Step 5: Wire workers into the cluster cron**

Locate the cron entry point that calls `runClusterBatch` (likely `app/api/cron/cluster/route.ts` or similar). In the same handler, after the Stage A batch, call:

```ts
import { runArbitrationBatch } from "@/workers/cluster/arbitrate";
import { runCanonicalTitleBatch } from "@/workers/cluster/canonical-title";
import { runEventCommentaryBatch } from "@/workers/cluster/commentary";

// after runClusterBatch() completes:
const arbReport = await runArbitrationBatch();
const titleReport = await runCanonicalTitleBatch();
const commentaryReport = await runEventCommentaryBatch();
// aggregate into the cron's return payload
```

Commit:
```bash
git add app/api/cron/cluster/route.ts   # or whatever the actual path is
git commit -m "feat(cron): wire Stage B/C/D into cluster cron tick

After Stage A clustering completes, run arbitrate → canonical-title →
event-commentary inline. Budget caps in each worker bound the cost.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Wave 3 — Read Path (serial)

**Policy:** inline / main. All tasks modify shared `lib/items/live.ts` + types; no parallelism safe.

### Task 3.1: Rewrite `lib/items/live.ts` with two views + event-level join

**Files:**
- Modify: `lib/items/live.ts`
- Modify: `lib/types.ts`
- Create: `lib/items/live.test.ts` (if not present)

- [ ] **Step 1: Add `view` + `hotWindowHours` to `FeedQuery`** in `lib/items/live.ts`:

```ts
export type FeedQuery = {
  // ... existing fields ...
  /** 'today' = trending (firstSeenAt today OR latestMemberAt within hot window).
   *  'archive' = events anchored to firstSeenAt.
   *  Default: 'archive' (backwards-compatible with current home-feed behavior
   *  until UI switches). After UI cutover, home sets 'today'. */
  view?: "today" | "archive";
  /** Hot window in hours for 'today' view. Default 24. */
  hotWindowHours?: number;
};
```

- [ ] **Step 2: Replace `buildFeedWhere` with view-aware version:**

```ts
function buildFeedWhere(q: FeedQuery) {
  const tier: Tier = q.tier ?? "featured";
  const view = q.view ?? "archive";
  const hotH = q.hotWindowHours ?? 24;

  // Event-tier fallback: COALESCE(cluster.event_tier, items.tier) so singletons
  // (which have no cluster or a memberCount=1 cluster) continue to use items.tier.
  const effectiveTier = sql`COALESCE(${clusters.eventTier}, ${items.tier})`;

  const tierFilter =
    tier === "p1"
      ? sql`${effectiveTier} = 'p1'`
      : tier === "featured"
        ? sql`${effectiveTier} IN ('featured', 'p1')`
        : sql`${effectiveTier} <> 'excluded'`;

  // Dedup filter unchanged.
  const dedupFilter = sql`(${items.clusterId} IS NULL OR ${clusters.leadItemId} = ${items.id})`;

  // View-specific time filter.
  const viewFilter =
    view === "today"
      ? sql`(
          ${clusters.firstSeenAt} >= date_trunc('day', now())
          OR ${clusters.latestMemberAt} > now() - make_interval(hours => ${hotH})
          OR (${items.clusterId} IS NULL AND ${items.publishedAt} >= date_trunc('day', now()))
        )`
      : sql`TRUE`;

  // Date filters (existing, for archive view's /all?date=X):
  const dateFilter = q.date
    ? sql`DATE(COALESCE(${clusters.firstSeenAt}, ${items.publishedAt})) = ${q.date}::date`
    : q.dateFrom || q.dateTo
      ? sql`COALESCE(${clusters.firstSeenAt}, ${items.publishedAt}) >= ${q.dateFrom ?? "1970-01-01"}::timestamptz
            AND COALESCE(${clusters.firstSeenAt}, ${items.publishedAt}) < ${q.dateTo ?? "2999-01-01"}::timestamptz`
      : sql`TRUE`;

  // ... sourceIdFilter / groupFilter / kindFilter / searchFilter / curatedFilter unchanged ...

  return and(
    isNotNull(items.enrichedAt),
    isNotNull(items.importance),
    tierFilter,
    dedupFilter,
    viewFilter,
    sourceIdFilter,
    groupFilter,
    kindFilter,
    dateFilter,
    searchFilter,
    curatedFilter,
  );
}
```

- [ ] **Step 3: Update `getFeaturedStories`** to:

1. Select additional cluster fields:

```ts
.select({
  // ... existing item/source fields ...
  canonicalTitleZh: clusters.canonicalTitleZh,
  canonicalTitleEn: clusters.canonicalTitleEn,
  clusterEditorNoteZh: clusters.editorNoteZh,
  clusterEditorNoteEn: clusters.editorNoteEn,
  clusterEditorAnalysisZh: clusters.editorAnalysisZh,
  clusterEditorAnalysisEn: clusters.editorAnalysisEn,
  clusterImportance: clusters.importance,
  clusterEventTier: clusters.eventTier,
  clusterFirstSeenAt: clusters.firstSeenAt,
  clusterLatestMemberAt: clusters.latestMemberAt,
  clusterCoverage: clusters.coverage,
  clusterHkr: clusters.hkr,
})
```

2. Update `ORDER BY` to be view-aware:

```ts
const orderBy =
  (q.view ?? "archive") === "today"
    ? sql`COALESCE(${clusters.latestMemberAt}, ${items.publishedAt}) DESC, COALESCE(${clusters.importance}, ${items.importance}) DESC`
    : sql`COALESCE(${clusters.firstSeenAt}, ${items.publishedAt}) DESC, COALESCE(${clusters.importance}, ${items.importance}) DESC`;

// ... .orderBy(orderBy)
```

3. Update the mapper to use COALESCE in JS:

```ts
const title =
  q.locale === "en"
    ? (r.canonicalTitleEn ?? r.titleEn ?? r.titleZh ?? r.title)
    : (r.canonicalTitleZh ?? r.titleZh ?? r.titleEn ?? r.title);

const editorNote =
  q.locale === "en"
    ? (r.clusterEditorNoteEn ?? r.clusterEditorNoteZh ?? r.editorNoteEn ?? r.editorNoteZh)
    : (r.clusterEditorNoteZh ?? r.clusterEditorNoteEn ?? r.editorNoteZh ?? r.editorNoteEn);

// similar for editorAnalysis, importance, tier
```

4. Add new Story fields to the return:

```ts
firstSeenAt: r.clusterFirstSeenAt?.toISOString() ?? undefined,
latestMemberAt: r.clusterLatestMemberAt?.toISOString() ?? undefined,
coverage: r.clusterCoverage ?? undefined,
canonicalTitleZh: r.canonicalTitleZh ?? undefined,
canonicalTitleEn: r.canonicalTitleEn ?? undefined,
stillDeveloping:
  r.clusterFirstSeenAt && r.clusterLatestMemberAt
    ? r.clusterFirstSeenAt < startOfToday() && r.clusterLatestMemberAt > oneDayAgo()
    : false,
```

(`startOfToday()` and `oneDayAgo()` are small date helpers; either inline or put in `lib/date.ts`.)

- [ ] **Step 4: Update `countFeaturedStories`** to match the new `buildFeedWhere` (it already reuses the same filter — should work automatically).

- [ ] **Step 5: Write tests for `buildFeedWhere`:**

```ts
// lib/items/live.test.ts
import { describe, it, expect } from "vitest";
import { getFeaturedStories } from "./live";
import { setupTestDB, seedItem, seedCluster, setClusterMembers } from "../../tests/helpers/db";

describe("getFeaturedStories — view semantics", () => {
  beforeEach(setupTestDB);

  it("today view includes events with latestMemberAt within 24h", async () => {
    // Seed: cluster with firstSeenAt = 3 days ago, latestMemberAt = 1h ago, tier=featured
    // Expect: appears in today view
  });

  it("today view excludes cold clusters (latestMemberAt > 24h ago, firstSeenAt < today)", async () => {
    // Seed: cluster with firstSeenAt = 3 days ago, latestMemberAt = 48h ago
    // Expect: excluded
  });

  it("today view includes fresh singletons published today", async () => {
    // Seed: item with no cluster, published today, tier=featured
    // Expect: appears
  });

  it("archive view returns events on their firstSeenAt day regardless of latestMemberAt", async () => {
    // Seed: cluster firstSeenAt = 2026-04-15, latestMemberAt = today
    // Query with date=2026-04-15 → cluster appears
    // Query with date=today → cluster does NOT appear (archive view anchors on firstSeenAt)
  });

  it("uses canonical_title_zh when present, falls back to item.title_zh", async () => {
    // Seed cluster with canonicalTitleZh set + members
    // Expect: returned Story.title === canonicalTitleZh for zh locale
  });

  it("uses cluster.editor_note_zh when present, falls back to item.editor_note_zh", async () => {
    // Same pattern
  });

  it("stillDeveloping flag set correctly", async () => {
    // Cluster firstSeenAt=yesterday, latestMemberAt=2h ago → stillDeveloping=true
    // Cluster firstSeenAt=today, latestMemberAt=1h ago → stillDeveloping=false (it's a new event, not developing)
    // Cluster firstSeenAt=3 days ago, latestMemberAt=48h ago → not in feed at all (cold)
  });
});
```

- [ ] **Step 6: Run tests**

Run: `bun test lib/items/live.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/items/live.ts lib/items/live.test.ts lib/types.ts
git commit -m "feat(feed): event-level read path with Today + Archive views

buildFeedWhere gains 'today' view (firstSeenAt today OR latestMemberAt
within hot window) vs 'archive' view (firstSeenAt day bucket).

getFeaturedStories selects cluster fields and uses COALESCE fallback:
singletons render unchanged, multi-member events pull canonical titles
+ commentary + importance from cluster.

Adds Story fields: coverage, firstSeenAt, latestMemberAt, canonicalTitle*,
stillDeveloping.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3.2: Update `lib/types.ts` — Story type extensions

**Files:**
- Modify: `lib/types.ts`

- [ ] **Step 1: Add new fields to the `Story` type:**

```ts
export type Story = {
  // ... existing fields ...
  coverage?: number;                // >= 1; undefined for singletons
  firstSeenAt?: string;             // ISO; cluster.first_seen_at (or item.publishedAt for singletons)
  latestMemberAt?: string;          // ISO; cluster.latest_member_at
  canonicalTitleZh?: string;
  canonicalTitleEn?: string;
  stillDeveloping?: boolean;        // derived server-side
  members?: Array<{                 // for signal drawer, populated only on demand (see Task 3.3)
    sourceId: string;
    sourceName: string;
    title: string;
    url: string;
    publishedAt: string;
    importance: number;
  }>;
};
```

- [ ] **Step 2: Type-check**

Run: `bun run typecheck`
Expected: no errors from the additions (optional fields don't break existing readers).

- [ ] **Step 3: Commit**

```bash
git add lib/types.ts
git commit -m "feat(types): extend Story for event aggregation (coverage, canonical titles, signal drawer)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3.3: Add `getEventMembers(clusterId)` + wire into API response

**Files:**
- Modify: `lib/items/live.ts` (add helper)
- Modify: `app/api/v1/feed/route.ts` or similar (populate `members` on demand)

- [ ] **Step 1: Add helper to `lib/items/live.ts`:**

```ts
export async function getEventMembers(clusterId: number, locale: Locale): Promise<NonNullable<Story["members"]>> {
  const client = db();
  const rows = await client
    .select({
      sourceId: items.sourceId,
      sourceNameZh: sources.nameZh,
      sourceNameEn: sources.nameEn,
      titleZh: items.titleZh,
      titleEn: items.titleEn,
      rawTitle: items.title,
      url: items.url,
      publishedAt: items.publishedAt,
      importance: items.importance,
    })
    .from(items)
    .innerJoin(sources, eq(items.sourceId, sources.id))
    .where(eq(items.clusterId, clusterId))
    .orderBy(desc(items.importance), items.publishedAt);

  return rows.map((r) => ({
    sourceId: r.sourceId,
    sourceName: locale === "en" ? r.sourceNameEn : r.sourceNameZh,
    title:
      locale === "en"
        ? (r.titleEn ?? r.titleZh ?? r.rawTitle)
        : (r.titleZh ?? r.titleEn ?? r.rawTitle),
    url: r.url,
    publishedAt: r.publishedAt.toISOString(),
    importance: r.importance ?? 0,
  }));
}
```

- [ ] **Step 2: Decide when to populate `Story.members`**

Two options (pick one):
1. **Always populate** — every Story with coverage ≥ 2 includes its members. Easy for UI, but 1 query per multi-member story = N+1.
2. **On-demand via separate endpoint** — `GET /api/v1/events/:clusterId/members` returns member list. UI fetches lazily on drawer open.

Pick option 2 for efficiency. Create `app/api/v1/events/[id]/members/route.ts`:

```ts
// app/api/v1/events/[id]/members/route.ts
import { NextResponse } from "next/server";
import { getEventMembers } from "@/lib/items/live";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const clusterId = parseInt(id, 10);
  if (Number.isNaN(clusterId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const url = new URL(req.url);
  const locale = (url.searchParams.get("locale") ?? "zh") as "zh" | "en";
  const members = await getEventMembers(clusterId, locale);
  return NextResponse.json({ members });
}
```

Heed the CLAUDE.md reminder ("This is NOT the Next.js you know — read node_modules/next/dist/docs/ before writing route handlers"). Check the project's conventions on params shape (Promise vs sync) before finalizing.

- [ ] **Step 3: Integration test** — seed 3-member cluster, hit endpoint, expect 3 members in importance-descending order.

- [ ] **Step 4: Commit**

```bash
git add lib/items/live.ts app/api/v1/events/
git commit -m "feat(api): /api/v1/events/:id/members returns signal drawer payload

Ordered by importance DESC, publishedAt ASC per HQ2 decision (no
per-member roles; ordering is sufficient).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3.4: Update `lib/items/semantic-search.ts` — cluster-aware dedup

**Files:**
- Modify: `lib/items/semantic-search.ts`

- [ ] **Step 1: Add cluster dedup to semantic-search query**

Pattern-match `buildFeedWhere`'s dedup filter. Add to the semantic-search WHERE:

```ts
.where(
  and(
    isNotNull(items.enrichedAt),
    isNotNull(items.embedding),
    // Dedup — only return cluster leads
    sql`(${items.clusterId} IS NULL OR ${clusters.leadItemId} = ${items.id})`,
    // ... existing filters ...
  ),
)
```

Add LEFT JOIN on clusters same way live.ts does.

- [ ] **Step 2: Run existing semantic-search tests**

Run: `bun test lib/items/semantic-search.test.ts` (if the file exists) or smoke test via `GET /api/v1/search?q=test`.
Expected: no regression in result count (dedup should only hide multi-member non-lead items, which are few).

- [ ] **Step 3: Commit**

```bash
git add lib/items/semantic-search.ts
git commit -m "feat(search): cluster-aware dedup in semantic search

Search results now return only cluster leads for multi-member events,
matching feed behavior. Singletons (clusterId IS NULL) unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Wave 4 — UI (parallel × 3 worktrees)

**Policy:** `parallel-worktree`. Three disjoint component files.

### Task 4.0: Set up UI worktrees + dispatch

- [ ] **Step 1: Worktrees**

```bash
git worktree add ../newsroom-wt-ui-badges -b feat/aggregation-ui-badges
git worktree add ../newsroom-wt-ui-drawer -b feat/aggregation-ui-drawer
git worktree add ../newsroom-wt-ui-integrate -b feat/aggregation-ui-integrate
```

Install node_modules per worktree if not already shared via pnpm store.

- [ ] **Step 2: Dispatch 3 parallel subagents** per `superpowers:subagent-driven-development`, one per worktree. Each receives DESIGN.md + this PLAN.md + its task ID (4.a, 4.b, 4.c) + reference to the terminal-aesthetic guide (`HANDOFF.md` or wherever design tokens live).

---

### Task 4.a (worktree: ui-badges): Badges + coverage chip

**Owner:** `newsroom-wt-ui-badges`
**Files:**
- Create: `components/feed/event-badge.tsx`
- Create: `components/feed/coverage-chip.tsx`
- Modify: `messages/zh.json` + `messages/en.json` (new keys)

- [ ] **Step 1: Add i18n keys**

`messages/zh.json`:
```json
{
  "feed": {
    "badge": {
      "new": "新",
      "newWithCount": "新 · {count} 信源",
      "stillDeveloping": "持续报道",
      "daysSinceFirst": "距首报 {days}d",
      "coverageChip": "由 {count} 信源报道"
    }
  }
}
```

`messages/en.json`:
```json
{
  "feed": {
    "badge": {
      "new": "NEW",
      "newWithCount": "NEW · {count} sources",
      "stillDeveloping": "STILL DEVELOPING",
      "daysSinceFirst": "{days}d in",
      "coverageChip": "{count} sources"
    }
  }
}
```

- [ ] **Step 2: Create `event-badge.tsx`:**

```tsx
// components/feed/event-badge.tsx
"use client";

import { useTranslations } from "next-intl";
import type { Story } from "@/lib/types";

export function EventBadge({ story }: { story: Story }) {
  const t = useTranslations("feed.badge");
  const coverage = story.coverage ?? 1;
  const firstSeen = story.firstSeenAt ? new Date(story.firstSeenAt) : null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const brokeToday = firstSeen && firstSeen >= today;

  if (brokeToday && coverage === 1) {
    return <span className="badge badge-new">{t("new")}</span>;
  }
  if (brokeToday && coverage >= 2) {
    return <span className="badge badge-new">{t("newWithCount", { count: coverage })}</span>;
  }
  if (!brokeToday && story.stillDeveloping && firstSeen) {
    const daysSince = Math.floor((today.getTime() - firstSeen.getTime()) / 86_400_000);
    return (
      <span className="badge badge-developing">
        {t("stillDeveloping")} · {t("daysSinceFirst", { days: daysSince })}
      </span>
    );
  }
  return null;  // quiet card
}
```

- [ ] **Step 3: Style the badges** — add to `app/terminal.css` or wherever theme tokens live. Terminal-aesthetic:

```css
.badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  letter-spacing: 0.04em;
  border: 1px solid var(--fg-muted);
  border-radius: 2px;
}
.badge-new {
  color: var(--accent-orange, #ff8000);
  border-color: currentColor;
}
.badge-developing {
  color: var(--accent-cyan, #00c0c0);
  border-color: currentColor;
}
```

(Adjust variable names to match existing terminal theme tokens — check `app/terminal.css`.)

- [ ] **Step 4: Create `coverage-chip.tsx`:**

```tsx
// components/feed/coverage-chip.tsx
"use client";

import { useTranslations } from "next-intl";
import type { Story } from "@/lib/types";

export function CoverageChip({
  story,
  onClick,
}: {
  story: Story;
  onClick?: () => void;
}) {
  const t = useTranslations("feed.badge");
  const coverage = story.coverage ?? 1;
  if (coverage < 2) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="coverage-chip"
      aria-label={t("coverageChip", { count: coverage })}
    >
      📰 {t("coverageChip", { count: coverage })}
    </button>
  );
}
```

Style `.coverage-chip` similar to badges, clickable affordance.

- [ ] **Step 5: Unit / visual tests**

Run: `bun test components/feed/event-badge.test.tsx` — test badge logic for each state (brokeToday+singleton, brokeToday+multi, stillDeveloping, quiet).

- [ ] **Step 6: Commit in ui-badges worktree**

```bash
git add components/feed/event-badge.tsx components/feed/coverage-chip.tsx messages/ app/terminal.css
git commit -m "feat(ui): event badges + coverage chip

NEW / STILL DEVELOPING badges on event cards, coverage chip triggers
signal drawer open on click. Terminal-aesthetic styling matches existing
feed card palette.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4.b (worktree: ui-drawer): Signal drawer component

**Owner:** `newsroom-wt-ui-drawer`
**Files:**
- Create: `components/feed/signal-drawer.tsx`
- Create: `components/feed/signal-drawer.test.tsx`

- [ ] **Step 1: Create the drawer component:**

```tsx
// components/feed/signal-drawer.tsx
"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { Story } from "@/lib/types";

type Member = NonNullable<Story["members"]>[number];

export function SignalDrawer({
  storyId,
  clusterId,
  locale,
  open,
  onClose,
}: {
  storyId: string;
  clusterId?: number;
  locale: "zh" | "en";
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("feed.badge");
  const [members, setMembers] = useState<Member[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !clusterId || members) return;
    setLoading(true);
    fetch(`/api/v1/events/${clusterId}/members?locale=${locale}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setMembers(d.members ?? []))
      .finally(() => setLoading(false));
  }, [open, clusterId, locale, members]);

  if (!open) return null;

  return (
    <div className="signal-drawer" role="region" aria-label={t("coverageChip", { count: members?.length ?? 0 })}>
      <header className="signal-drawer__header">
        <span>{t("coverageChip", { count: members?.length ?? 0 })}</span>
        <button type="button" onClick={onClose} aria-label="close">×</button>
      </header>
      {loading && <p className="signal-drawer__loading">...</p>}
      {!loading && members && (
        <ul className="signal-drawer__list">
          {members.map((m) => (
            <li key={m.url} className="signal-drawer__member">
              <a href={m.url} target="_blank" rel="noopener noreferrer">
                <span className="signal-drawer__source">📎 {m.sourceName}</span>
                <span className="signal-drawer__time">{relativeTime(m.publishedAt, locale)}</span>
                <span className="signal-drawer__title">{m.title}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function relativeTime(iso: string, locale: "zh" | "en"): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return locale === "zh" ? `${mins}分钟前` : `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return locale === "zh" ? `${hrs}小时前` : `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return locale === "zh" ? `${days}天前` : `${days}d ago`;
}
```

- [ ] **Step 2: Style `.signal-drawer`** in `app/terminal.css`. Accordion/inline style, not modal. ~400px max height with scroll. Terminal monospace aesthetic.

- [ ] **Step 3: Tests**

```tsx
// components/feed/signal-drawer.test.tsx
// Render with open=false → returns null
// Render with open=true + clusterId → fetches /api/v1/events/:id/members
// Mock fetch, provide 3 members, assert all rendered in order
// Click close → onClose called
// Click a member link → opens in new tab (target=_blank rel=noopener)
```

- [ ] **Step 4: Commit in ui-drawer worktree**

```bash
git add components/feed/signal-drawer.tsx components/feed/signal-drawer.test.tsx app/terminal.css
git commit -m "feat(ui): signal drawer — expandable member list for multi-source events

Opens inline below event card. Fetches /api/v1/events/:id/members on demand
(not on feed render) to avoid N+1. Members ordered by importance DESC.
Each row links to source article in new tab.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4.c (worktree: ui-integrate): Integrate badges + chip + drawer into `item.tsx` + home feed switch

**Owner:** `newsroom-wt-ui-integrate`
**Files:**
- Modify: `components/feed/item.tsx`
- Modify: `app/[locale]/page.tsx` (home — switch to view='today')
- Modify: `app/[locale]/all/page.tsx` (archive — ensure view='archive' explicitly)

- [ ] **Step 1: Update `components/feed/item.tsx`** to render badge + chip + drawer:

Import and use:
```tsx
import { EventBadge } from "./event-badge";
import { CoverageChip } from "./coverage-chip";
import { SignalDrawer } from "./signal-drawer";

// inside the item render:
const [drawerOpen, setDrawerOpen] = useState(false);
// Story.clusterId would need to be exposed on the Story type or passed separately.
// Since DESIGN.md doesn't surface clusterId, decide: either add it to Story, or derive from Story.id + server call.
// Cleanest: add clusterId?: number to Story type (Task 3.2 extension).

// render:
<div className="item-header">
  <EventBadge story={story} />
  {/* existing source + time */}
  <CoverageChip story={story} onClick={() => setDrawerOpen(true)} />
</div>
{/* existing title + summary + editor note + analysis */}
<SignalDrawer
  storyId={story.id}
  clusterId={story.clusterId}
  locale={locale}
  open={drawerOpen}
  onClose={() => setDrawerOpen(false)}
/>
```

If clusterId is not yet on Story, add it (small change to lib/items/live.ts mapper + lib/types.ts).

- [ ] **Step 2: Update home (`app/[locale]/page.tsx`)** to pass `view: "today"` when calling `getFeaturedStories`:

Locate the feed query. Set `view: "today"` in the FeedQuery arg.

- [ ] **Step 3: Update `/all` (`app/[locale]/all/page.tsx`)** to explicitly pass `view: "archive"`.

- [ ] **Step 4: Start dev server + smoke test**

```bash
bun run dev
# in another shell:
curl -s http://localhost:3009/ | grep -oE 'badge-(new|developing)' | head -5
curl -s 'http://localhost:3009/all?date=2026-04-15' | grep -oE 'coverage-chip' | head -5
```

Expected: at least one badge class appears (once data is there — may be empty pre-migration, that's fine for now).

- [ ] **Step 5: Commit in ui-integrate worktree**

```bash
git add components/feed/item.tsx app/[locale]/page.tsx app/[locale]/all/page.tsx lib/types.ts lib/items/live.ts
git commit -m "feat(ui): integrate badges + coverage chip + signal drawer into feed card

Home now uses view='today' (trending, latestMemberAt DESC).
/all?date=X uses view='archive' (firstSeenAt anchored).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4.M: Merge UI worktrees back

Same pattern as Task 2.M. Expect conflicts on `app/terminal.css` (4.a + 4.b both append styles); resolve by concatenating.

---

## Wave 5 — Migration + Backtest (serial)

### Task 5.1: Create `scripts/ops/backtest-cluster.ts`

**Files:**
- Create: `scripts/ops/backtest-cluster.ts`
- Create: `docs/aggregation/HAND-LABELED-PAIRS.md` (seed list written by operator)

- [ ] **Step 1: Write the backtest script skeleton**

The script:
1. Parses args (`--threshold`, `--window`, `--since`, `--stage-b`, `--output`).
2. Creates shadow tables: `backtest_items`, `backtest_clusters` (CTAS from real tables).
3. Re-embeds? NO — uses existing embeddings (per DESIGN.md §10).
4. Runs tuned clustering against shadow (reuses `assignOneToCluster` logic via a shadow-mode flag, or duplicates the SQL with `backtest_` prefix).
5. If `--stage-b`, runs the arbitrator against shadow clusters.
6. Generates reports:
   - `cluster-diff.md` — Markdown table: total clusters before/after, member-count histogram, avg member per cluster
   - `moved-items.csv` — CSV of items whose cluster-id differs
   - `spot-check-sample.md` — 30 random multi-member clusters with all member titles listed (operator reviews)
   - `stage-b-log.jsonl` — one line per arbitrator call with verdict + reason
   - `hand-labeled-recall.md` — reads `docs/aggregation/HAND-LABELED-PAIRS.md`, checks each pair's merged status, reports `N/20 merged`

Full implementation ~300 LOC. Refer to `scripts/ops/` for existing script patterns.

- [ ] **Step 2: Create `HAND-LABELED-PAIRS.md`** — operator-seeded list of ~20 known-related article pairs. Example format:

```md
# Hand-Labeled Related-Pair Seed List

20 pairs of articles we KNOW cover the same event, used to measure Stage A recall
in the backtest harness. Operator maintains.

## Pair 1 — GPT-5.5 Launch (2026-04-10)
- item_id=12345  OpenAI Blog — "Announcing GPT-5.5"
- item_id=12367  The Information — "OpenAI releases GPT-5.5 ahead of schedule"

## Pair 2 — Anthropic Claude Opus 4.7 (2026-04-12)
- item_id=12401  Anthropic Blog — "Claude Opus 4.7 — more intelligent, more affordable"
- item_id=12422  量子位 — "Claude Opus 4.7 发布：更聪明更便宜"

(...18 more pairs...)
```

- [ ] **Step 3: Commit**

```bash
git add scripts/ops/backtest-cluster.ts docs/aggregation/HAND-LABELED-PAIRS.md
git commit -m "feat(ops): backtest harness for tuned clustering (Stage A + optional Stage B)

Runs tuned params against shadow tables, diffs vs current state, writes
reports to docs/reports/backtest-YYYY-MM-DD/. Operator gate: spot-check
+ >=16/20 hand-labeled recall pairs merged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5.2: Run backtest + operator gate

- [ ] **Step 1: Populate `HAND-LABELED-PAIRS.md` with at least 20 real pairs** (operator writes this; AI can propose candidates but human confirms).

- [ ] **Step 2: Run backtest**

```bash
bun run scripts/ops/backtest-cluster.ts \
  --threshold 0.80 \
  --window 72 \
  --since '2026-04-01' \
  --stage-b \
  --output docs/reports/backtest-$(date +%Y-%m-%d)/
```

- [ ] **Step 3: Operator reviews reports**

Read `docs/reports/backtest-YYYY-MM-DD/spot-check-sample.md` — eyeball all 30 sampled clusters. Flag any that look like false merges. Also read `hand-labeled-recall.md` — must be ≥16/20 merged.

**Autonomous gate decision** (per big-task Phase -1 for BLOCK/FLAG verdicts): ≥16/20 pairs merged AND zero operator-flagged clusters in the 30-sample → PASS, proceed to Task 5.3. If < 16/20 OR any flagged cluster → raise threshold to 0.82, re-run backtest. If still failing, this is a CRITICAL DECISION (pickup with user — the algorithm isn't working as designed).

---

### Task 5.3: Create migration script + apply

**Files:**
- Create: `scripts/migrate/events-from-clusters.ts`

- [ ] **Step 1: Write migration script** matching DESIGN.md §9 sequence:

1. Backfill `clusters.latest_member_at` from `MAX(member.publishedAt)`
2. Backfill `first_seen_at` where null from `MIN(member.publishedAt)`
3. Copy lead item's commentary fields → cluster
4. Null `commentary_at` on multi-member clusters (regen flag)
5. Compute importance + tier via `recomputeEventImportance` from Task 1.2, persist to clusters
6. Set `coverage = member_count`
7. Set `verified_at = NULL` on all (pre-Stage-B state)

All steps in a transaction, idempotent.

- [ ] **Step 2: Dry-run on a DB copy**

If possible: `pg_dump production | pg_restore test_db`; run migration against test_db; verify invariants:
- No orphan items (items with clusterId not in clusters)
- All clusters have firstSeenAt + latestMemberAt
- Multi-member cluster commentary_at is NULL (awaiting regen)
- Singleton cluster commentary fields copied verbatim from lead item

- [ ] **Step 3: Apply to production**

```bash
bun run scripts/migrate/events-from-clusters.ts
```

- [ ] **Step 4: Verify**

```bash
psql $DATABASE_URL <<'SQL'
SELECT
  (SELECT count(*) FROM clusters) AS clusters_total,
  (SELECT count(*) FROM clusters WHERE first_seen_at IS NOT NULL) AS clusters_with_first_seen,
  (SELECT count(*) FROM clusters WHERE latest_member_at IS NOT NULL) AS clusters_with_latest_member,
  (SELECT count(*) FROM clusters WHERE member_count >= 2 AND commentary_at IS NULL) AS multi_awaiting_regen,
  (SELECT count(*) FROM clusters WHERE member_count = 1 AND editor_note_zh IS NOT NULL) AS singletons_with_commentary;
SQL
```

Expected: `clusters_with_first_seen == clusters_total`, `clusters_with_latest_member == clusters_total`, `multi_awaiting_regen > 0` if multi-member clusters exist, `singletons_with_commentary ≈ (count of singletons with enriched lead)`.

- [ ] **Step 5: Commit**

```bash
git add scripts/migrate/events-from-clusters.ts
git commit -m "feat(migrate): one-shot migration from item-level to event-level commentary

Backfills latest_member_at + first_seen_at. Copies lead-item commentary
to cluster for singletons; flags multi-member clusters for regen by
nulling commentary_at. Recomputes event_tier + importance with coverage
boost. Idempotent — safe to re-run.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5.4: Flip feature flag + cutover

- [ ] **Step 1: Set env var in production**

```bash
vercel env add ENABLE_EVENT_AGGREGATION true production
vercel env add ENABLE_EVENT_AGGREGATION true preview
```

(Per memory: Vercel bakes env at deploy — redeploy after setting.)

- [ ] **Step 2: Redeploy** — `vercel --prod` or push to main branch (per project's CI).

- [ ] **Step 3: Smoke test**

```bash
curl -s 'https://<prod-host>/api/v1/feed?view=today&limit=5' | jq '.items[] | {id, coverage, firstSeenAt, canonicalTitleZh}'
```

Expected: 5 items, some with `coverage >= 2` (if any multi-member events exist).

---

## Wave 6 — Verification + PR (serial)

### Task 6.1: E2E tests

**Files:**
- Create: `tests/e2e/aggregation.spec.ts`

- [ ] **Step 1: Write Playwright tests** covering:
  - Home page: NEW badge visible on at least one card (seed if needed)
  - Home page: STILL DEVELOPING badge on a multi-day event
  - Clicking coverage chip opens signal drawer; drawer lists members
  - `/all?date=YYYY-MM-DD` shows events anchored by firstSeenAt
  - Singleton event (coverage=1) renders without badges — no regression

- [ ] **Step 2: Run**

```bash
bun run test:e2e -- tests/e2e/aggregation.spec.ts
```

Expected: all green.

### Task 6.2: Visual verification sweep

- [ ] **Step 1: Playwright screenshot capture** of changed routes × theme variants

```bash
bun run scripts/ops/screenshot-sweep.ts --routes / /all /api/v1/events/1/members --themes terminal-dark terminal-light --output docs/reports/aggregation-visual-$(date +%Y-%m-%d)/
```

- [ ] **Step 2: Inline visual verification** (≤3 PNGs) or parallel subagents (≥4 PNGs)

For each screenshot, Read + compare against existing home feed baseline + `HANDOFF.md` terminal aesthetic. Verdict: PASS / FLAG / BLOCK.

BLOCK → fix inline before proceeding.
FLAG → TodoWrite follow-up, continue.

### Task 6.3: Code review — `feature-dev:code-reviewer` on full diff

```
git diff main...HEAD > docs/reports/aggregation-full-diff.patch
# dispatch feature-dev:code-reviewer with this diff
```

Address CRITICAL + HIGH findings inline. MEDIUM → deferred-follow-up tag.

### Task 6.4: `think-ultra` on milestone diff

Same diff, run `think-ultra` for architecture / regression / security review. Address HIGH.

### Task 6.5: PR

```bash
gh pr create --title "feat: cross-source event aggregation (tier 4)" --body "$(cat <<'EOF'
## Summary
- Promotes `clusters` to first-class editorial events with LLM-arbitrated membership, canonical titles, event-level commentary, coverage-boosted importance.
- Two reader views: Today (trending) + Archive (firstSeenAt day-bucket).
- Signal drawer surfaces cross-source coverage on event cards.
- Backtest-gated cutover via `ENABLE_EVENT_AGGREGATION` env flag.

## Phases shipped
- Wave 1: schema + importance pure fn + HNSW restore
- Wave 2: workers — Stage A tune + Stage B arbitrate + Stage C canonical-title + Stage D event-commentary (parallel worktree)
- Wave 3: read path rewrite with COALESCE fallback
- Wave 4: UI — badges + coverage chip + signal drawer + home switch to Today view (parallel worktree)
- Wave 5: migration + backtest harness + operator gate + prod cutover
- Wave 6: E2E + visual + code review + ultra-review

## Tests added
- Unit: N (importance, arbitrate, canonical-title, event-commentary, live feed semantics)
- Integration (real DB, mocked LLM): N (end-to-end cluster flow)
- E2E: N (home today view, archive view, signal drawer open)

## Risks / follow-ups
- Stage B prompt will need tuning based on cluster_splits audit review after week 1
- Admin UI for manual merge/split deferred (operator edits via SQL for now)
- Event permalink page deferred (signal drawer on card is sufficient for v1)

## Test plan
- [ ] Backtest report green (docs/reports/backtest-YYYY-MM-DD/)
- [ ] Migration verified on DB snapshot before prod
- [ ] Feature flag gates cutover
- [ ] Visual verification sweep PASS on home + /all + event members endpoint
- [ ] First 24h post-deploy: cluster_splits table < 10% of multi-member clusters (confirms Stage B isn't over-splitting)

## Autonomous decisions made
- Big-bang scope (Option A) with backtest harness as pre-ship gate (user confirmed)
- Storage: extend clusters in place, alias as `events` in TS (vs. rename — less risk)
- Stage B: inline with cluster cron, cap 15/run (vs. separate cron — less latency)
- Clustering window: ±72h published-anchored (vs. current 48h now()-anchored — fixes backfill)
- Embedding input unchanged (title + summaryZh) — backtest decides if summaryEn augmentation needed
- Two reader views (Today + Archive) with STILL DEVELOPING badge vs. single hybrid score

@claude please review.
EOF
)"
```

---

## Self-Review

**1. Spec coverage:**

- ✅ Schema changes (§5 of DESIGN.md) → Task 1.1
- ✅ Stage A tuning (§6.1) → Task 2.a
- ✅ Stage B arbitrator (§6.2) → Task 2.b
- ✅ Stage C canonical title (§6.3) → Task 2.c
- ✅ Stage D event commentary (§6.4) → Task 2.d
- ✅ Importance model (§6.5) → Task 1.2
- ✅ Read path rewrite (§7) → Tasks 3.1-3.4
- ✅ UI badges + drawer (§8) → Tasks 4.a-4.c
- ✅ Data migration (§9) → Task 5.3
- ✅ Backtest harness (§10) → Tasks 5.1-5.2
- ✅ Rollback (§11) → env flag in Task 5.4
- ✅ Testing strategy (§12) → woven into each task + Task 6.1
- ✅ Visual verification → Task 6.2
- ✅ Decision log (§15) → implicit in task design; each HQ/Q resolution is in the relevant task's behavior

**2. Placeholder scan:** No TBDs. Every task has concrete code or concrete pointer-to-pattern ("pattern-match workers/enrich/index.ts"). A few "follow the pattern" references are intentional for subagent latitude.

**3. Type consistency:** `recomputeEventImportance` signature consistent across Task 1.2, 2.b, 2.d, 5.3. `Story.members` shape consistent across Task 3.2, 3.3, 4.b. `FeedQuery.view` consistent across Task 3.1, 4.c.

**4. Known intentional gaps** (explicit YAGNI or deferred):
- Event permalink page — explicitly non-goal (DESIGN.md §3)
- Admin UI for manual cluster edits — non-goal
- Full re-embedding with summaryEn — contingent on backtest result (Task 5.2 gate)

Plan is ready for execution.

---

## Execution Handoff

Plan complete and saved to `docs/aggregation/PLAN.md`. Execution mode:

**Subagent-Driven Development** — parallel worktree dispatch in Waves 2 & 4, fresh subagent per task, two-stage review between tasks (spec-compliance + quality) per `superpowers:subagent-driven-development`.

This matches the user's "自动完成" directive and fits the tier-4 scope.
