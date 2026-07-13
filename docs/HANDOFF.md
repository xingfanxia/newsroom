# AX's AI RADAR — Current Handoff

## 2026-07-13 — W9 read-budget: cron cadence + cache-purge + scale (in progress)

W8 shipped but a full decomposition (6-agent workflow + a clean 22.9-min prod
measurement) showed the run-rate is still **~824k rows/h ≈ ~590M/mo, ~6× over the
<100M target**. Two structural facts: (1) the **cron/background floor alone is
~148k rows/h ≈ 107M/mo** — over the target with zero feed traffic; (2) the feed is
dominated by **getDayCounts**, a 60-day calendar scan whose cache is purged 6×/hr
unconditionally by the content crons (`_route.ts` has no content-changed guard), so
it reprimes every ~10 min. AX's call: this is fundamentally a **daily-update site,
run too frequently** → attack frequency + scale. Shipping in 3 measurable PRs.

**W9a — content-cron cadence cuts (SHIPPED via PR #50, squash 1b47362).** `vercel.json` only
(+ the cron-cadence tests). Aggressive daily-site cadence:
- `cluster` `55 * * * *` → `55 4,12,20 * * *` (3×/day, phased so a run lands at
  04:55 — just before newsletter-daily at 05:00, which dedups by cluster_id and
  can't dedup still-unclustered items). Its ±72h NN pipeline is ~50k reads/tick,
  so frequency IS the lever. New items still appear immediately as singletons via
  enrich; only event-grouping lags ≤8h.
- `commentary` `10,40 * * * *` → `10 */12 * * *` (2×/day). 200/run × 2 > ~190/day
  ingest, no backlog.
- `score-backfill` `25 * * * *` → `25 6 * * 1` (weekly). Drained legacy backfill
  that full-scanned ~20k enriched rows hourly to find 0 work.
- `article-body` `0,15,30,45 * * * *` → `0 * * * *` (hourly, 4× cut, NOT 3×/day).
  Deliberately kept hourly: body-fetch is throughput-critical (anon Jina tier
  MAX_PER_RUN=20 → <24 runs/day starves the ~190/day ingest). Its real cost is the
  **`items_unfetched_body_idx` leak** (never-stamped x-status rows accumulate) —
  fixed by index narrowing in W9b, not by cadence.
- `enrich` unchanged (4×/h, ~2k reads/h, keeps new items fresh).
- Parser note: `cadenceMinutesFromCron` was extended to parse evenly-spaced comma
  hour-lists (e.g. `4,12,20` → every 8h), so the cluster phase-shift is expressible
  without breaking the W7 non-null cadence guard.
- **Coupled constants the code-review caught (fixed in the same PR):** three
  constants silently assumed "cluster runs ≥ hourly" and broke at 3×/day —
  (1) `MERGE_RECENCY_HOURS` 6→24 (was < the 8h cadence → a ~2h/run band of
  clusters never got re-merged → duplicate event cards); (2)
  `MAX_EVENT_COMMENTARY_PER_RUN` 8→16 (event commentary runs inside the cluster
  tick, so its throughput was 8×-cut → bare cards on burst days; 16 fits the 300s
  invocation budget); (3) `EVENT_COMMENTARY_CRON_RECENCY_HOURS` 24→36 (~4 cluster
  runs of coverage so a starved low-importance event still gets an editor note).
- Est. background floor drop ~148k → ~42k rows/h (score-backfill→0, commentary/
  cluster amortized down). article-body's 32k/h stays until W9b's leak fix.

**W9b — cache-purge decouple + getDayCounts seek (SHIPPED, PR #51, pure code, no
migration).** The dominant per-render read is getDayCounts (60-day calendar scan);
it was cache-purged ~4×/h by the content crons, repriming almost every enrich tick.
Three fixes:
- `feed-cache.ts` — getDayCounts moved to its OWN `feed-calendar` tag (6h TTL, NOT
  cron-purged). Reprime rate drops from the enrich heartbeat (~4×/h) to the TTL
  (~4×/day). The cheap bounded-window aggregates (radar/pulse/top-topics/ticker)
  stay on the `feed` tag (30-min TTL). ≤6h calendar staleness is fine — the feed
  is never calendar-gated, so new items still show live.
- `dashboard-stats.ts` — getDayCounts pins `items_feed_recent_idx` (published_at
  LEADS) not `items_feed_cover_idx` (published_at LAST). getDayCounts ALWAYS has a
  `published_at >= floor` bound → the recency index SEEKs the 60d window instead of
  scanning the whole (ever-growing) enriched corpus. **No new index — recent_idx
  exists since W8.** EXPLAIN proof: recent_idx `SEARCH … (published_at>?)` vs
  cover_idx `SEARCH … (enriched_at>?)` (full corpus). Both COVERING.
- `_route.ts` — `revalidateFeed` now accepts a predicate; a cron purges the `feed`
  aggregate cache only when its run changed content (enrich enriched>0,
  score-backfill rescored>0, normalize created>0). cluster stays unconditional
  (7-stage, ~always mutates, 3×/day; a reliable cross-stage predicate is fragile).

**W9b-idx — commentary partial index (SHIPPED, PR #52, squash 5b0e3fe; index LIVE
on prod).** Scope CUT after measurement: the article-body `items_unfetched_body_idx`
narrowing was **dropped** — the "32k/h leak" estimate was wrong; the dead-weight
accumulation is only **1,373 never-fetchable rows** (~1-2M/mo at hourly cadence),
not worth a fragile `NOT (LIKE OR LIKE)` partial index that risks silent
planner-match failure. Kept the robust half: `items_commentary_pending_idx ON items
(tier, cluster_id) WHERE commentary_at IS NULL`. The commentary worker scanned every
visible-tier row (measured **8,926**) 2×/day to find the ~27 commentary-pending
(~1M/mo); the partial index collapses that to ~27. Applied to prod via
`db-optimize.ts` (17.6s build); the UNPINNED plan check PASSes with a `(tier=?)` SEEK
(planner structurally selects it — no INDEXED BY pin needed). database-reviewer pass
(both hardening findings applied). AX granted STANDING authorization for prod
index/cache ops via db-optimize.ts, so no per-index confirm.

**Gate-hygiene follow-up (found during W9b):** the local `bun run test` gate is
NON-hermetic — a CLASS of `(real DB)` tests run whenever `TURSO_DATABASE_URL` is set
(`.env.local` points at PROD): the feedback writes (`tests/feedback/toggle.test.ts`)
AND the search-API reads (`/api/public/search`, `/api/v1/search` — seen timing out at
20s/5s in the W9b verify run). They hit the live prod DB and intermittently time out
under Turso's global write-lock contention with the running production crons. Worse, a bun **timeout** failure does NOT reliably
propagate a non-zero exit (`VERIFY_EXIT=0` seen with a visible `(fail)`) — synchronous
assertion fails DO exit 1 (gate-probe verified), only async timeouts mask. Mitigation
in use: always cross-check `VERIFY_EXIT` with `grep -c "(fail)"`. Real fix (separate
PR): gate the `(real DB)` writes behind an explicit opt-in env (not bare
`TURSO_DATABASE_URL`) so the default gate is hermetic. **Vercel CI is unaffected — it
runs only `next build`, never `bun run test`.**

**W9c-1 — main RSS recency floor (SHIPPED, PR #53, squash 46f264d, non-breaking).**
The decisive finding: the routes split by caching. `/api/feed/[locale]/rss.xml` is
`revalidate=600` but each render is a full **21,666-row cover scan** (getFeaturedStories,
no floor) — a continuously-polled reader drives that ~288×/day/locale ≈ **~187M rows/mo
at full poll**, plausibly the largest remaining sink. Fix: `MAIN_RSS_RECENCY_FLOOR_DAYS
= 14` on the PRIMARY featured query → pins `items_feed_recent_idx`, SEEKs the 14d
window (**2,682 rows, ~8× cut**). Non-breaking: RSS is recent-by-nature and prod has
373 featured+p1 leads in 14d (7.5× the 50-item limit) → byte-identical output. The
slow-day `tier:'all'` fallback stays UNFLOORED (drought safety net). code-reviewer
caught + fixed a CRITICAL: the test's bare `mock.module` dropped @/lib/items/live's
other exports → reddened the gate by breaking 7 suites; fixed with a spread
partial-mock.

**W9c-2 — feed+search JSON API cache (SHIPPED, PR #54, non-breaking).** AX chose
option (b): NON-breaking caching over a breaking floor (we have NO HTTP traffic data
for these JSON endpoints, so a speculative floor would break the contract for a
possibly-nonexistent cost). The `force-dynamic`, UNCACHED feed+search surfaces
(`/api/public/feed`, `/api/v1/feed`, `/api/public/search`, `/api/v1/search`, MCP
ax_radar_feed/search — ~43k rows/call for the lexical/feed scan, plus an embedding
call for semantic) now wrap the two shared execution paths (`runFeedQuery`,
`runSearchQuery` in `lib/api/{feed,search}-results.ts`) in `unstable_cache` — 10-min
TTL, own tags `feed-api`/`search-api`, NOT cron-purged (pure TTL is the strongest
db-load bound). Non-breaking: no floor, totals + pagination unchanged; bounds a hot
param combo to ~1 DB execution/TTL (modulo a small refresh-boundary thundering-herd).
Key details:
- **Call-time cache construction** — the wrapper is built INSIDE `run*Query`, not at
  module scope. `unstable_cache`'s Data Cache key is
  `cb.toString()+keyParts+JSON.stringify(args)`, independent of wrapper identity, so
  per-call construction is prod-identical to a module-scope singleton (verified vs
  Next 16.2.4 source) AND re-mockable in tests (module-scope was untestable: ~8
  earlier suites import these modules before the cache test's `mock.module`
  registers). Same call-time style as `feed-cache.ts` `getDayCountsCached`.
- **Semantic key canonicalization + latency** — semantic always returns offset 0 and
  pages via dates, so `offset`+single-day `date` are stripped from the cache key
  (paging dedupes to one entry); real end-to-end `latencyMs` is stamped OUTSIDE the
  cache so a hit reports its true (fast) time, not the frozen miss-time value.
- **Security** — auth/rate-limit run in the route adapters OUTSIDE `run*Query` (hit
  still traverses the limiter, no bypass); shared-across-public/v1/MCP cache invariant
  documented on `execute*Query` (no caller-privilege-dependent filtering inside).
- **Freshness tradeoff (intended, AX-approved):** DATA contract unchanged; freshness
  ≤10-min — new items invisible to the JSON APIs for up to a TTL, `view=today`
  ordering + `stillDeveloping` freeze for the TTL. Consistent with RSS `revalidate=600`
  + feed-cache 30min/6h. `view=today` is the most staleness-visible surface → revisit
  its TTL first if it ever bites.
- **Tests** — real Map-based memoizer mock (reproduces the arg key) exercises dedup /
  no-collision / semantic offset-canonicalization / the latency override (deterministic
  via a mocked advancing clock, no wall-clock flake); spread-mocks avoid the
  process-global export-drop leak. code-reviewer (opus) APPROVE, all LOW/NIT fixed.

**W9c-3 — legacy per-source RSS cache (SHIPPED, PR #55, non-breaking).** A sweep for
any OTHER uncached read path (per AX "add caching wherever necessary") found one: the
legacy per-source RSS route `/api/rss/[slug]` is `force-dynamic` (it runs a per-request
rate-limiter `rssRateLimit`, so it can't use route-level revalidate like the main/
newsletter RSS). Its query (`listLegacyLaneRows`: items JOIN sources ORDER BY
published_at DESC LIMIT 50) is a cheap top-50 index walk for non-curated lanes, BUT the
**curated** lane filters post-JOIN to the single curated source (1 of 55 on prod) →
prod EXPLAIN `SCAN i USING COVERING INDEX items_feed_recent_idx` can walk the FULL
~21.6k-row items index to fill LIMIT 50 (same unbounded-scan class as the pre-floor main
RSS). Fix: new module `lib/rss/legacy-feeds-cache.ts` wraps `renderLegacyRssFeed` (kept
pure) in `unstable_cache` (10-min TTL, own non-cron-purged `legacy-rss` tag); route
keeps rssRateLimit per-request (runs BEFORE the cached render → no bypass). **Split into
its own module** so the test stubs renderLegacyRssFeed one level down WITHOUT globally
mocking `@/db/client` — bun's mock.module is process-global and a db() stub poisons every
`(real DB)` test (hit + fixed mid-change). Other force-dynamic read routes checked and
left uncached (items/[id]=PK lookup, sources=55 rows, events/members=per-event,
daily=one row/day — all light). Completes the RSS surface: main floored, newsletter
revalidate=600, legacy now cached. code-reviewer (opus) APPROVE, all LOW/NIT fixed.

All unbounded read PATHS are now bounded. Target after full W9: durable ~70M/mo.

**W9 measurement baseline (for the forward run-rate proof).** Billing-period
cumulative `rows_read` = **597.68M @ 2026-07-13** (over the 500M free cap — but this
period includes the pre-W9 days; the accumulated damage is sunk). The proof of the W9
cuts is the **forward run-rate (rows/h over the next clean day)**, NOT the cumulative
(masked by the sunk pre-W9 reads + edge cache + lagged usage API). Shipped this
session: W9a (cadence) + W9b (feed-cache decouple + getDayCounts seek) + W9b-idx
(commentary index) + W9c-1 (RSS floor). Pull current usage:
`curl -s -H "Authorization: Bearer $TURSO_API_TOKEN" https://api.turso.tech/v1/organizations/xingfanxia/databases/newsroom-v2/usage`
(token in `~/.claude/turso.env`; NEVER print it).

## 2026-07-13 — W8 read-budget: feed recency floor + aggregate cache

Attacks the REAL read hog identified 2026-07-13: >90% of the read bill is
uncached public-feed renders (each rescanned ~144k rows), NOT clustering. Two
halves.

**W8a — recency-floored feed index (shipped, PR #48 `2d58e75`).** The public
default views only need recent items, but the cover index
`items_feed_cover_idx` has `published_at` LAST, so a floor could only *filter*,
not *seek*. Added `items_feed_recent_idx (published_at, enriched_at, importance,
tier, cluster_id, source_id)` — leads with `published_at` so a floor SEEKS.
`buildFeedWhere`/`feedIndexFor` (`lib/items/live.ts`) apply a floor via
`INDEXED BY` (Turso rejects `ANALYZE`, so hot queries pin the index). **Aggressive
policy** (AX-chosen): home today=7d, daily-highlights/all/curated=30d;
source-filtered + API/RSS/MCP views unbounded; an explicit calendar date always
bypasses the floor (`hasExplicitDateBound` short-circuits it). Accepted tradeoff:
a still-developing event whose lead `published_at` predates the floor drops from
the default view (still reachable via calendar). **Measured on prod**: 143,954 →
68,954 rows/render (52%) — larger than the ~28% item-scan estimate because the
floor also shrinks the per-item clusters JOIN probe. Prod index created BEFORE
the code deploy (additive b-tree) so `INDEXED BY` resolved; all 13 PLAN_CHECKs
pass on prod.

**W8b — aggregate + calendar-count cache (THIS PR).** Every public render also
recomputes `getDayCounts` (60-day calendar scan the floor can't bound — the
dominant residual cost), the radar/pulse widgets, top-topics, and the ticker.
Pages read `searchParams` → that voids `export const revalidate`, so each request
re-renders dynamically and recomputes all of them. New adapter
`lib/shell/feed-cache.ts` wraps the 5 readers in `unstable_cache` under one shared
`'feed'` tag (TTL 1800s backstop). The 4 content-mutating crons (enrich / cluster
/ score-backfill / normalize) call `revalidateFeedCache()` →
`revalidateTag('feed','max')` after writing, so a new/enriched/clustered/scored
item surfaces on the next regenerated render, not on the TTL. Fetch buckets +
commentary/article-body crons deliberately do NOT purge (they touch only
fields no cached aggregate reads, or only un-enriched rows; radar/pulse raw
counts lag ≤15 min via enrich's heartbeat). Invalidation completeness was mapped
against every runtime write path (code-reviewer confirmed, no gaps).
`'max'` is stale-while-revalidate: the first render after a purge may serve the
prior value once while it regenerates. Manual `scripts/ops/*` mutations bypass the
purge (TTL backstop, ≤30 min). Tests: `tests/shell/feed-cache.test.ts` (13 —
behavioral with `next/cache` mocked + wiring tripwires) + updated
calendar-counts/radar-stats source assertions to the `*Cached` names.

**Next:** measure combined W8 per-render drop on prod; watch the forward
run-rate (clean-day delta ×30) over the next full clean day. W4 + W7-ANN(A1)/A6
still remain from the read-budget backlog.

## 2026-07-13 — Tweaks/locale single-source-of-truth + persist hardening

Follow-up on the language-desync fix (`main`: site-config LANGUAGE toggle
flipped chrome to 中文 but left feed titles English — dual source of truth
between the URL `[locale]` segment and client `tweaks.language`).

- **URL `[locale]` is the ONLY language source.** `TweaksProvider` takes
  `initialLanguage` (the route locale the server used to resolve titles);
  `resolveTweaks(urlLanguage, …overrides)` force-sets `language` on every merge
  and drops any persisted `language` (incl. legacy `"both"`). The config toggle
  + `locale-switcher` now `router.replace({pathname, query}, {locale})` —
  navigation flips chrome AND titles together, no client-only language state.
- **`language` is no longer persisted** (localStorage or `users.tweaks`):
  `persistableTweaks()` strips it before every write — it's URL-derived and
  never read back, so storing it was dead, misleading data.
- **`TWEAKS_SCHEMA` (`lib/tweaks.ts`) is now the single source of truth for
  tweak field shapes.** The server PATCH validator (`lib/api/tweak-requests.ts`)
  derives its body schema via `TWEAKS_SCHEMA.partial()`; the client validates
  untrusted persisted/fetched blobs field-by-field via `parsePersistedTweaks()`
  (drops corrupt/unknown fields rather than nuking the whole config).
- Tests: `tests/shell/use-tweaks.test.ts` (pure helpers) +
  `tests/shell/tweaks-provider.test.tsx` (new — happy-dom, scoped register/
  unregister; asserts URL-locale wins, server-over-local merge, language never
  persisted, and the debounced PATCH body strips `language`). Full suite green.

## 2026-07-13 — W7 read-budget DEPLOYED (P3 executed end-to-end)

**Both PRs merged to `main`; production is live on the W7 code.** AX authorized
the full prod sequence ("全部自己 merge deploy apply ddl"). Executed:

1. **Backup** — `db-dump.ts` → `backups/2026-07-13T06-29-32-415Z/` (parity-checked,
   15 tables, items=21638 + clusters=16346 incl. embeddings). Restore point.
2. **DDL applied to prod** (idempotent, PRAGMA-guarded): `items.last_recheck_at`
   (`db:add-recheck-column`), the 3 W567 cluster-fix columns
   (`add-cluster-fix-columns.ts`), and the A3 partial index
   `clusters_multimember_idx` (`db:optimize`, all 12 PLAN_CHECKS PASS on real prod
   data confirming structural index selection). Verified live via PRAGMA/sqlite_master.
3. **Digest opt-out** — targeted `set-digest-clustering-optout-20260713.ts --apply`
   (NOT `db:seed`, to avoid clobbering manual `curated` prod drift). ai-chatgroup-daily
   + aihot-selected → `clustering_opt_out=1`.
4. **#42 merged** (merge commit `feda34a`, `ax/cluster-recall-precision`) → deployed OK.
5. **#43 merged** (merge commit `ce62ede`, `ax/w7-read-budget`) → prod deploy Ready,
   aliased `news.ax0x.ai`, sfo1. Prod health: `/en` 200.
6. **Scoped digest-unlink** — `unlink-digest-cluster-members-20260712.ts --apply`:
   1826 digest items unlinked; scoped reconcile (1678 clusters) → 1300 zombie
   clusters GC'd + 378 aggregates fixed + 24 leads repointed (1300+378=1678 ✓).
   Post-state: 0 digest items still clustered; clusters 16346→15047.

**⚠️ Unlink reconcile scoping fix (commit `78fb3ce`, in #43).** The unlink called
`reconcileClusters()` with NO `clusterIds` → it reconciled ALL 16,346 clusters, not
just the ones it touched (docstring said "affected clusters"; code was global).
Decomposition of the 16,237-cluster "drift" it flagged: **member_count drift = 0,
coverage drift = 0** — 100% is a `latest_member_at` timestamp artifact (stored value
vs `max(clustered_at)`, magnitude up to ~172h) from the pg→Turso migration + merge-time
bumps, **unrelated to digest cleanup** and feeding the merge 6h window + feed ordering.
Fix: pass `clusterIds: affectedClusterIds` to both reconcile calls → blast radius
16,237 → the 1,678 clusters actually modified. **The ~14.7k untouched clusters keep
their `latest_member_at`; the global artifact is LEFT ALONE as a separate decision**
(reconcile defines `latest_member_at = max(clustered_at)`, but merge-time semantics may
intentionally diverge — do NOT globally rewrite it without validating that semantic).

**Read-budget baseline: `newsroom-v2` rows_read = 554,440,281 @ 2026-07-13 ~06:52 UTC**
(cumulative *cycle* total, dominated by the one-off migration flood — will NOT drop;
it resets at cycle boundary). W7 success = a lower forward **run-rate**, measured as
a clean-day delta ×30 over the next full day, NOT a drop in this cumulative number.

**Post-deploy checks — ✅ all verified** (:55 cluster tick): A.5 stamped
`last_recheck_at` (68 rows first tick), opt-out holds (contamination 0 after the
tick), cluster cron `GET /api/cron/cluster 200`, no "no such column".

**Follow-ups resolved 2026-07-13:**
- **A5 monitor cron — WIRED** (daily GitHub Actions `read-budget-monitor.yml`;
  `TURSO_API_TOKEN` secret set). Rolling-window run-rate projection → fails loud
  (email) over 60M/mo + cumulative catastrophe backstop. SHA-pinned actions, no
  npm install, schedule/dispatch-only triggers. ⚠️ SECURITY NOTE: the token can
  delete Turso DBs and the repo is PUBLIC — Turso has no scoped read-only token
  for the usage API. Hardened in place; the cleaner alternative is Vercel Cron
  (token in private Vercel env). See the monitor-cron PR.
- **A6 CLOSED** — not a read lever (A.5 outer query already `items_tier_idx`-bounded
  per EXPLAIN; `last_recheck_at` walk is latency-only, not billed rows).
- **A1 (ANN) CLOSED** — not needed after A2 (negligible marginal cut, approximate,
  needs a ≥99% recall backtest); reopen only if the monitor's run-rate demands.
- **Clean-day rows_read re-measurement** — now the cron's ongoing job (baseline
  556.8M @ 2026-07-13 07:42 UTC seeded).

---

## 2026-07-12 — W7 read-budget BUILT → PR #43 (charter `docs/FIX-W7-read-budget-2026-07-12.md`)

The durable read-budget fix. Branch `ax/w7-read-budget`, **stacked on #42**
(`ax/cluster-recall-precision`). Goal: steady-state Turso `rows_read` **< 100M/mo**
(design projection ~10–15M). Multipass-reviewed (code-reviewer + database-reviewer,
all findings fixed); non-live + full `bun test` gate green (exit 0).

**Two corrections to the quota-block diagnosis below (measured in P1):**
- **The 549.6M was a ONE-OFF flood, not steady-state.** Through 2026-07-11 prod
  had read only **2.84M cumulative** — it was reading ~nothing. The 554M spike on
  2026-07-12 was migration-day work (pg→Turso copy + verify + 95+58 audit agents +
  backtests). The pipeline was nonetheless **structurally able to re-bust** (A.5
  ~99M/mo projected), which is what W7 fixes.
- **ANN routing is NOT the dominant lever.** The quota section below called
  "two-stage ANN (`vector_top_k`)" *the* W7 fix. P1 EXPLAIN showed **Stage A is
  already index-bounded** (`SEARCH … USING items_published_at_idx`, ~456 rows/probe
  — not a full scan). The real dominant cost was **A.5 re-scanning the same
  singletons ~144×/72h**. So the shipped fix is the **A.5 waterline (A2)**, not ANN.
- **Region: nothing was re-homed.** `newsroom-v2` is in group `default` @
  aws-us-west-2, co-located with the sfo1 app (~20ms) — always was. (`tokyo` group
  holds the unrelated exif-photo-blog-ax.)

**Shipped in PR #43 (projected ~10–15M/mo, from ~110–175M unfixed):**
- **A2 — A.5 recheck waterline** (`items.last_recheck_at`, 12h cooldown). Kills the
  ~144× redundant re-scan (dominant, ~100× cut). Candidate window = neighbor-window
  + cooldown (**84h**) so no in-window neighbor is missed (recall guarantee).
- **A4 — cadence** `12,42 * * * *` → `55 * * * *` (hourly; fetch is already hourly).
- **A3 — partial index** `clusters(member_count, updated_at) WHERE member_count>=2`
  bounds the arbitrate + canonical-title candidate scans (~16K → ~1.1K). Structural
  selection (no ANALYZE / no pin — empirically confirmed).
- **A5 — read-budget monitor** (`scripts/ops/read-budget.ts`) — billing API →
  grade vs cap + project run-rate; fails loud, cron-ready.
- **A1 (ANN) + A6 (A.5 outer index) DEFERRED** to post-deploy measurement. A1 is
  *approximate* → needs a ≥99% recall backtest before it can ship; after A2 its
  marginal cut isn't worth a blind clustering-quality risk.

**P3 — ✅ EXECUTED 2026-07-13** (see the DEPLOYED block at the top of this file).
Sequence run: back up → apply `last_recheck_at` DDL + A3 index → targeted opt-out →
merge #42/#43 → deploy → scoped digest-unlink. Remaining: clean-day rows_read
re-measurement (delta ×30 < 100M) + wire A5 as a cron. A6/A7 escalation: the charter.

## 2026-07-12 — W5+W6 recall/precision APPLIED (FIX-W567 charter, PR `ax/cluster-recall-precision`)

Follow-on to the FIX-GOAL charter below. Implements the **product-gated +
surgical** remainder of the clustering audit: W5 (precision), W6 (staleness),
and the safe parts of W4/W7. Charter + AX product decisions:
`docs/FIX-W567-2026-07-12.md`. What shipped (branch `ax/cluster-recall-precision`,
commits `0528d57` + review-fix `3407978`):

- **W5.1 cohesion gate** — Stage-A join now requires the item be within
  `COHESION_MAX_DISTANCE` (0.35) of the cluster **lead**, not just the nearest
  member (kills single-link chaining). Pure decision extracted to
  `resolveJoinOutcome()` (unit-tested; the "strong clustered match always wins"
  invariant is encoded in the function, not just the caller's scan-skip).
- **W5.2 digest opt-out** — `sources.clustering_opt_out` flags 群聊日报 / AI HOT;
  `notClusteringOptedOut()` excludes them from every Stage A / A.5 candidate +
  neighbor query. They render as standalone cards, never join/bridge a cluster.
- **W5.3 structural no_content** — `clusters.no_content` stamped by the Stage-C
  LLM is now the PRIMARY merge-skip signal (LIKE list kept as transitional
  fallback).
- **W6a tombstone re-open** — new `workers/cluster/reopen.ts` (Stage B− before
  arbitrate) nulls `verified_at` + members' `cluster_verified_at` (atomically)
  when a grown cluster has a member drifted > `REOPEN_COHESION_DISTANCE` (0.38)
  from the lead. **Lead-anchored, O(members)**, full-embedding space (NOT
  embedding_small — thresholds are calibrated there). Loop-safe via
  `latest_member_at > verified_at`.
- **W6b commentary regen** — `clusters.commentary_member_count`; regen on 2×
  growth OR featured/p1 tier-upgrade with no analysis. Loop-safe via count-stamp
  + `editor_analysis_zh` guard. Extracted `commentaryRegenClause()`.
- **W4a** — a split leaving 1 survivor no longer stamps `verified_at` (keeps it
  visible to A.5).
- **W7a** — `withBusyRetry()` / `retryTransaction()` (capped exponential backoff)
  wrap every cluster-pipeline write transaction on transient SQLITE_BUSY.

Schema: 3 new columns applied to prod via the idempotent PRAGMA-guarded
`scripts/ops/add-cluster-fix-columns.ts` (db:push stays banned). Multipass
review (opus code-reviewer + database-reviewer) run; all findings fixed.

**Gate:** non-live `verify` steps all green (typecheck + lint 0-warn + build +
3 knip checks + 130 local cluster/db tests). ⚠️ Full `bun run verify` currently
exits non-zero ONLY on `workers/newsletter/select.test.ts` (`selectDailyColumnPool`
hits the live Turso DB, which is under a **read-quota block**). See the quota
diagnosis below.

### 🔴 Turso read-quota block — DIAGNOSED 2026-07-12 (measured via billing API)

`newsroom-v2` burned **549.6M rows_read = 109.9% of the 500M monthly cap** in ~1
calendar day (the DB was only created at the pg→Turso cutover). **Writes are NOT
blocked** (7.15M/10M). Cap **auto-resets 2026-08-01 04:00 UTC** (~20 days); this
tier has **no pay-through overage** — only reset or a plan upgrade unblocks reads.

- **What busted it (this time):** a ONE-OFF migration-day flood — pg copy-in + row
  verify, `recluster-historical` re-runs during threshold tuning, cluster-health /
  repair / backtest fired dozens of times by the 95+58 audit agents, plus ~6.75h of
  unindexed home-feed full-scan regression. (`db-dump` read only ~0.5M rows — 346MB
  is bytes, not rows — NOT the culprit.)
- **Will prod re-bust on its own? YES — structural (W7).** `workers/cluster/` Stage
  A / A.5 / reopen / merge run `vector_distance_cos` over the FULL 3072-dim
  `embedding` in `ORDER BY … LIMIT 1` (no index satisfies → every predicate row is
  read), while the 256-dim DiskANN `items_embedding_small_idx` sits used only by
  `semantic-search.ts`. A.5 has no waterline (re-scans the same singletons ~144×/72h)
  × 48 ticks/day. **This reframes W7 from a deferred perf item to the quota-critical
  fix.**
- **The fix (W7):** two-stage ANN via `vector_top_k('items_embedding_small_idx', …)`
  then rerank on the full vector (`semantic-search.ts:103` is the template) +
  `INDEXED BY` pins on the arbitrate/canonical-title/commentary 16K-cluster scans +
  A.5 `last_recheck_at` waterline.
- **Free mitigations before the fix / reset:** throttle or pause the cluster cron
  (`:12,:42`), freeze any audit/backfill/db-dump against prod, and add a staging
  Turso DB or `hasDb` skip-gate (`bun test` currently connects straight to prod —
  part of what fed this flood).
- **AX decision (only $/region tradeoff):** wait for the 8/1 reset ($0, ~20 days
  read-limited) vs upgrade **Developer** ($4.99/mo, 2.5B reads, immediate unblock —
  but Developer is single-region, would drop the current 2-region setup).
- **This PR's prod ops under the block:** `add-cluster-fix-columns.ts` (metadata-only
  `ADD COLUMN` + PRAGMA schema guard, no user-row reads) can likely run even now, but
  `db:seed` (upsert reads) and `unlink` (`SELECT`) will hit the read block — run the
  whole prod-ops sequence AFTER reset/upgrade.

**Prod ops NOT yet applied (confirm-before-apply — Turso is the only data copy):**
backup (`db-dump.ts`) → `add-cluster-fix-columns.ts` → `bun run db:seed` →
optional `unlink-digest-cluster-members-20260712.ts --apply`. See the charter's
"Prod ops" section.

**Still open (deferred bigger redesigns):** W4 singleton-twin arbitrated daily
sweep + A.5 window redesign; W7 DiskANN routing of Stage A/A.5, A.5 waterline,
pipeline cron split, write-lock collapse to set-based statements.

## 2026-07-12 — Audit remediation APPLIED (FIX-GOAL charter, PR `ax/audit-fixes`)

The bounded charter `docs/FIX-GOAL-2026-07-12.md` is **DONE** — P0 safety +
W1-W3 + the quick wins, tasks T1-T7. What shipped:

- **P0 safety (T6):** `db:push` neutered (`echo … && exit 1` — no more
  `drizzle-kit push --force` one-liner that would drop `items.embedding` +
  the DiskANN index); Turso `delete_protection` **enabled** for `newsroom-v2`;
  new `scripts/ops/db-dump.ts` streams every table to gzipped JSONL under
  git-ignored `backups/` with per-table row-count parity (346 MB verified
  backup taken before any mutation). Restore doc: `docs/ops/db-backup-restore.md`.
- **W1 split-loop reunite vector (T2):** `mergeClusters` now unlinks (not
  reunites) loser items that hold a `cluster_splits` row vs the winner;
  `cluster_splits_item_cluster_uq` unique index added + `onConflictDoNothing`
  on the arbitrate insert (57 731 historical dup rows deduped first).
- **W2 lead integrity (T3):** `applySplitVerdict` re-picks `lead_item_id` from
  survivors (via `pickBestLead`) when a split ejects the current lead.
- **W3 bookkeeping atomicity (T4):** item-claim+count-bump and the
  promote-neighbor path wrapped in `client.transaction`; `coverage` moved to
  lockstep with `member_count`; `cluster-health.ts --repair` is the standing
  reconciler (shared `workers/cluster/reconcile.ts`).
- **T1 one-off prod repair:** `scripts/migrations/repair-cluster-drift-20260712.ts`
  applied — 109 aggregates fixed, 1 zombie deleted, 10 leads re-pointed, 5
  stuck clusters cleared for re-arbitration. cluster-health now: 0 drift /
  0 dangling / 0 zombies / 0 merge-eligible-unmerged.
- **T7 unbounded queries:** `dailySpend` bounded+indexed (was ~39s → covering
  scan), `breakdownByModel` all-window pinned to a covering index,
  semantic-search brute-force fallback recency-bounded + loud log.

**Still open at the time of THIS charter (most now shipped in the FIX-W567
charter above — see it for current status):** W4 (singleton-twin arbitrated
sweep, A.5 window redesign), W5 (cohesion gate, digest `clustering_opt_out`,
structural `no_content` flag), W6 (tombstone re-open + commentary regen
policy), W7 (DiskANN routing of Stage A/A.5, pipeline cron split, SQLITE_BUSY
retry wrapper). W5 + W6 + W4a + W7a landed in FIX-W567; the W4/W7 bigger
redesigns remain deferred. The two audit reports below remain the source of
truth for the deferred items.

Original audit context (findings adversarially verified; reports are the
per-workstream source of truth). **The charter was `docs/FIX-GOAL-2026-07-12.md`**
(bounded scope: P0 safety + W1-W3 + quick wins). Reports:

- **Clustering audit** → `docs/reports/cluster-audit-2026-07-12/`
  (FINDINGS.md + DATA.md). Headlines: the June-12 split-loop fix left the
  merge-stage reunite vector open (W1); arbitrate can eject a cluster's lead
  and the feed then renders nothing for it (W2, 11 live cases); singleton
  twins >72h apart are permanently un-mergeable (W4, real duplicate cards);
  digests (群聊日报/AI HOT) contaminate 37% of multi clusters (W5); Stage
  A/A.5 brute-force 3072-dim scans instead of the existing 256-dim DiskANN
  index (W7). The member_count drift on 6 clusters is a **migration
  artifact** (clusters table captured before items during the live-pg copy;
  id-keyed topup never reconciled UPDATEs) — repair SQL in the report.
  Health check: `bun --env-file=.env.local scripts/ops/cluster-health.ts`.
- **Turso residue audit** → `docs/reports/turso-residue-audit-2026-07-12/`.
  P0: `db:push` hardcodes `--force` (one habitual command away from dropping
  items.embedding + the vector index) and there is **no backup of the only
  data copy** (delete-protection off, no dumps). Then: two 37-39s unbounded
  query paths (admin usage stats, semantic-search brute-force fallback), no
  SQLITE_BUSY retry story, no safe next-schema-change procedure.

## 2026-07-12 — Feed-path query plans pinned (5s TTFB incident)

Day-2 after the Turso cutover the home page hit 3.5–8.6s TTFB. Root cause:
**Turso's sqld rejects `ANALYZE`** ("SQL not allowed statement"), so
`sqlite_stat1` can never exist and the query planner runs on default guesses
forever. For the home feed it walked `items_published_at_idx` expecting the
LIMIT to saturate early — but the today-view filters match only a few dozen
rows, so it fetched every enriched row from the payload-heavy table pages
(~10s cold; 41–150ms via the covering index).

Standing rule this creates: **every latency-sensitive query over `items` or
`clusters` must pin its index with `INDEXED BY`** — the stat-less planner
cannot be trusted with sparse filters, and pinning fails loudly if the index
is ever dropped. Current pins:

- `getFeaturedStories` (lib/items/live.ts): two-phase id-subquery pinned to
  `items_feed_cover_idx` + `clusters_feed_cover_idx`; the outer query's
  ORDER BY uses unary `+published_at` so the planner can't fall back to the
  published_at scan. `countFeaturedStories` and `getDayCounts` pin the same
  pair.
- `getRadarStats`/`getPulseData`: shared 24h bound moved into the outer WHERE
  so `items_created_tier_idx` serves the counts (was a full-table aggregate).
- `getTopTopics`: single materialized 7-day scan (was 3×) pinned to the
  covering partial `items_topics_cover_idx`.
- `getRecentTickerItems`: pinned to `items_created_tier_idx`.

`bun run db:optimize` (scripts/ops/db-optimize.ts) creates the non-vector
perf indexes (raw SQL — remember `db:push` is unsafe against the live DB, see
the caveat below) and asserts each hot query still plans onto its pinned
index; rerun it after touching feed-path queries or indexes. Result:
home-page data functions now 0.5s cold / ~0.15s warm total (was ~9.4s + 3s).

## 2026-07-11 — Database migrated: Supabase Postgres → Turso libSQL (SQLite)

The entire DB layer moved to **Turso libSQL** (DB **`newsroom-v2`**, org
`xingfanxia`, `aws-us-west-2` — co-located with the `sfo1` Vercel region pin;
the first `newsroom` DB was abandoned after a runaway index build wedged its
write path, then deleted). Supabase is decommissioned. What changed:

- **Client**: `db/client.ts` is `@libsql/client` (HTTP hrana) + `drizzle-orm/libsql`.
  Env: `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` (all Vercel envs + `.env.local`).
  `libsqlClient()` exposes the raw client for batch/vector SQL.
- **Storage conventions** (see `db/schema.ts` header): timestamps = INTEGER ms
  epoch (drizzle `timestamp_ms` mode — app code still sees JS `Date`), jsonb →
  JSON text, booleans → 0/1, `serial` → INTEGER PK AUTOINCREMENT, `numeric` →
  REAL, `text[]` → JSON text array, pg enums → typed TEXT.
- **Vectors**: pgvector `halfvec(3072)`+HNSW → libSQL native `F32_BLOB(3072)`
  plus a **Matryoshka 256-dim candidate column** (`embedding_small`, truncated
  + L2-renormalized; `embeddingToSmall` in db/schema.ts). 3072-dim DiskANN is
  unbuildable on Turso (~6s/row; a bulk CREATE INDEX wedges the write path —
  killed the first `newsroom` DB). The partial DiskANN index
  `items_embedding_small_idx` lives on the SMALL column and was fed
  incrementally by `scripts/ops/backfill-embedding-small.ts` (rerun any time;
  idempotent — also the right way to REBUILD the index: create empty, feed by
  batched UPDATEs, never bulk-build). Semantic search: small-index top-500 →
  exact re-rank on FULL vectors (results measured identical to brute-force;
  prod ~0.2-0.4s warm vs 2-10s). Brute-force fallback auto-engages if the
  index is missing. Enrich writes both columns. Distances are cosine
  (0 = identical).
- **Row layout invariant (SQLite)**: big payloads (`items.body`, `body_md`,
  `embedding`; `raw_items.raw_payload`) MUST stay the LAST columns — SQLite
  inlines them in the row and reading any later column walks their overflow
  pages (measured 29s vs 182ms on the joined feed count). Covering index
  `items_feed_cover_idx` keeps feed/count scans off the fat rows entirely.
- **Claims**: enrich's `FOR UPDATE SKIP LOCKED` CTE became a single atomic
  `UPDATE ... WHERE id IN (SELECT ... LIMIT n) RETURNING` (SQLite single-writer).
- **FK enforcement**: Turso enables `foreign_keys` server-side by default —
  cascades verified live; no client pragma needed.
- **db:push caveat**: drizzle-kit false-diffs the custom vector column
  (drizzle-orm #3047) — NEVER accept a push plan that drops/recreates
  `items.embedding`, and rerun `db:vector-index` after every push.
- Data copied 2026-07-11 (all 15 tables, count-verified, embeddings as raw F32
  buffers). Historical pg-era manual migrations (`db/migrations/manual/`)
  removed; RLS doc marked superseded.


## 2026-06-12 — Code-quality and docs source-of-truth cleanup

Current maintenance direction:
- Start docs navigation from `docs/README.md`; historical plans/handoffs are useful context, not current implementation instructions.
- `bun run verify` is the one-command local quality gate for agents before
  committing: typecheck, lint, build, Knip gates, and the full Bun test suite.
- `bun run lint` is expected to be clean with zero warnings.
- `bun run typecheck` is expected to run standalone `tsc --noEmit` cleanly,
  including tests and Bun runtime APIs.
- `bun run code:dead` is the low-noise Knip gate for unused files/dependencies/unresolved imports and should exit cleanly. `bun run code:dead:exports` checks value exports and `bun run code:dead:types` checks type exports; both should stay clean.
- `upsertAppUser(user)` upserts the effective user row, including API-token users, before FK-owned mutations.

Shipped cleanup:
- Added repo-specific `knip.json` entry/project patterns for Next routes, tests, workers, scripts, and config files.
- Added `bun run verify` as the single local gate that chains typecheck, lint,
  build, dead-code checks, and tests so future agents do not have to infer the
  expected verification order from handoff prose.
- Added `docs/testing/strategy.md` as the current testing/verification strategy
  entry in the docs router.
- Added `docs/architecture/overview.md` as the current architecture map for
  ownership boundaries and change-routing decisions.
- Removed unused UI/source-row components, the unused Tavily integration stub, and unused direct package dependencies.
- Removed/de-exported unused internal value exports across auth, i18n navigation, policy, rate-limit, utility, worker, X API, newsletter, normalizer, and cluster modules.
- Removed/de-exported unused internal type-only exports in the LLM usage and facade modules.
- Added a standalone `typecheck` script backed by `tsc --noEmit`, added Bun
  runtime/test types, and aligned drifting test fixtures so agents can run a
  TypeScript gate without relying on `next build` as the only type signal.
- Replaced stale `tsx` operator-script hints with `bun`.
- Shared resumable operator state-file path/load/save behavior through
  `scripts/ops/state.ts`; backfill scripts keep their own state shape but no
  longer duplicate JSON parsing, `updatedAt` refreshes, or ENOENT handling.
- Shared admin section headings through `components/admin/section-header.tsx`
  and moved `/admin/usage` task/model/recent-call tables into a private
  `_usage-tables.tsx`, so the page owns data orchestration instead of table
  rendering details.
- Shared admin table shell styling through `components/admin/table-frame.tsx`
  so `/admin/usage` and `/admin/system` do not repeat the same terminal table
  frame wrapper.
- Shared radar stats ownership through `lib/shell/radar-stats.ts`; shell pages,
  the radar widget, and DB dashboard stats now reuse the same `RadarStats`
  type plus empty fallback instead of repeating the four-field zero object.
- Aligned radar top-bar signal math with the 24h radar window: P1/featured
  counts now use the same window as `items_today`, and top-bar ratios are
  clamped to display-safe 0..1 bounds.
- Shared top-bar stats mapping through `lib/shell/top-bar-stats.ts`; pages now
  pass radar stats through one helper instead of hand-copying tracked-source
  counts and signal-ratio rules into every `ViewShell`.
- Shared shell chrome data loading through `lib/shell/chrome-data.ts`;
  `ViewShell` pages no longer repeat radar fallback, optional pulse loading,
  or top-bar stat mapping before rendering.
- Shared newest-first feed sorting through `sortStoriesNewestFirst` in
  `lib/feed/group-by-day.ts`; archive-style pages no longer hand-copy
  published-at descending comparators before UTC day grouping.
- Shared feed page query coercion through `lib/feed/page-query.ts`; home,
  all-posts, and curated routes no longer duplicate the date drilldown key,
  nonnegative offset parsing, or 500-row day drilldown limit.
- Shared feed empty-state styling through `components/feed/empty-state.tsx`;
  feed-like pages now keep their empty copy local but no longer duplicate the
  terminal centered empty-state treatment.
- Shared archive pagination through `components/feed/archive-pagination.tsx`;
  `/all` no longer owns local pagination markup, and `/curated` now exposes
  the offset pagination its query path already supported.
- Shared feed time display helpers through `lib/time/relative.ts`; feed rows
  and event-member drawers no longer carry untested local relative-time
  formatters.
- Kept translated relative-time tokens in `lib/time/relative.ts`; admin
  feedback rows no longer import a time helper from the generic `lib/utils.ts`
  class-name utility module.
- Derived usage dashboard window totals and admin range parsing from the shared
  `USAGE_WINDOWS` / usage-summary helpers; `/admin/usage` no longer depends on
  hand-written `today/week/month/all` totals or local query-param casts when the
  usage window contract changes.
- Shared `/admin/usage` provider/model label formatting through
  `lib/llm/usage-display.ts`, so task spend summaries and recent-call rows
  both identify the provider instead of showing ambiguous deployment names.
- Shared current LLM default model/deployment labels through
  `lib/llm/model-defaults.ts`; provider resolution, pricing fallback, and
  operator backfill cost forecasts no longer repeat the same DeepSeek, GPT,
  and embedding defaults, and `.env.example` is now tested against the same
  contract while labeling Azure OpenAI chat as compatibility/probe rather than
  the default enrich/score path. LLM request type comments stay
  provider-oriented so default deployment labels do not leak into type docs.
- Reused `APP_LOCALES` in `i18n/routing.ts`, so Next locale routing and
  API/OpenAPI/agent locale contracts no longer carry separate hard-coded
  `zh/en` tuples.
- Kept the public agent endpoint inventory in `docs/agent-access/README.md`
  as the current source of truth; README and ingestion architecture summaries
  now link there instead of repeating endpoint counts or path lists.
- Shared RSS content-type/cache and rate-limit labels through
  `lib/rss/http-contract.ts`; `/agents` no longer hand-writes RSS HTTP header
  facts or imports server-side RSS rendering/rate-limit modules, and legacy RSS
  feeds use the same default cache contract as main/newsletter RSS routes.
- Derived the login locale switcher options from `APP_LOCALES`, keeping the
  compact label mapping local while removing another route-locale enum copy.
- Shared locale pathname-prefix parsing through `appLocaleFromPathname` and
  `stripAppLocalePathPrefix`, so admin gating and shell nav active-state logic
  no longer carry separate `/zh|/en` regexes.
- Centralized mobile bottom-tab nav values in `NAV_MOBILE_TABS`, deriving route
  tabs from `NAV_PRIMARY` so desktop rail, mobile drawer, and mobile tab links
  cannot drift on core route hrefs.
- Shared shell nav href construction through `navHrefForLocale`, so desktop
  rail and mobile chrome no longer duplicate locale-prefix and `#` handling.
- Reused `APP_LOCALES` for tweak language options, so browser preferences and
  API tweak validation cannot drift from app route locales.
- Centralized `AppLocale` to BCP-47 language-tag mapping in
  `appLocaleLanguageTag`, so RSS rendering and saved-export date formatting no
  longer repeat `zh-CN` / `en-US` branches.
- Shared UI/admin date-format language tags through `appLocaleLanguageTag` /
  `AppLocaleLanguageTag`, so calendar, usage, version timeline, and iteration
  date formatting do not repeat `zh-CN` / `en-US` branches.
- Shared `sources.never_exclude` tier-floor handling through
  `workers/enrich/source-tier.ts`; live enrich and score-backfill now use the
  same source allow-list instead of a YouTube suffix heuristic.
- Derived main RSS feed ordering and locale coercion from `APP_LOCALES`, so RSS
  discovery metadata cannot drift from the app/API locale contract.
- Derived main RSS feed BCP-47 language tags from `appLocaleLanguageTag`, so
  channel metadata no longer repeats `zh-CN` / `en-US` next to the locale
  tuple.
- Shared admin mono blocks through `components/admin/mono-block.tsx`; policy
  error states and policy body previews no longer duplicate preformatted
  terminal panel styling.
- Shared admin monospace form controls through `components/admin/mono-field.tsx`;
  `PolicyEditor` now reuses common textarea/input styling while keeping its
  save, dirty-state, and confirmation behavior local.
- Reused `VISIBLE_ITEM_TIERS` in `/admin/system` queue SQL and enrich-worker
  retry priority SQL, so queue telemetry and re-enrich ordering cannot drift
  from the feed/commentary tier contract.
- Centralized fetch-cron cadence buckets in `workers/fetcher/pipeline.ts`;
  HTTP fetch routes and local `scripts/ops/run-cron.ts` now pass only the
  fetch-cron slug and cannot drift on `live/hourly/daily/weekly` membership.
- Updated README / `.env.example` / architecture docs so Tavily is not advertised as wired, cron docs match the current split route set, and cluster docs match the 0.75 / 72h runtime.
- Clarified the AI HOT documentation source of truth: root README and
  `docs/architecture/ingestion.md` now route current runtime behavior to the
  architecture doc, while `docs/aihot-integration/PLAN.md` is explicitly a
  shipped historical design record.
- Added archive banners to every `docs/aggregation/HANDOFF*.md` entry so
  direct readers see current clustering/cron/feed behavior is documented in
  `docs/architecture/ingestion.md`, not in older session handoffs.
- Archived `docs/aggregation/DESIGN.md` and `docs/aggregation/PLAN.md` in the
  same routing layer, so direct readers do not mistake the original
  event-aggregation spec/checklist for current implementation guidance.
- Standardized archive banners and source-contract coverage for
  `docs/aihot-integration/PLAN.md`, `docs/AGENT-MCP-PLAN.md`, and
  `docs/SESSION8-PUNCHLIST.md`, so old shipped plans and punchlists cannot be
  mistaken for current agent instructions.
- Standardized daily-column archive banners and source-contract coverage for
  `docs/daily-column/DESIGN.md`, `docs/daily-column/PLAN.md`, and
  `docs/daily-column/HANDOFF-2026-04-25.md`, replacing current-sounding launch
  handoff read-order language with historical routing.
- Aligned `docs/architecture/ingestion.md` with current runtime schema and
  policy lifecycle: scores/tags/policy hash live on `items`, policy content
  lives in `policy_versions.content`, iteration proposals live in
  `iteration_runs.proposed_content`, and policy changes only affect new or
  explicitly reset/backfilled enrich work.
- Aligned `/admin/system` queue telemetry with worker predicates: item commentary now counts only singleton/unclustered item candidates, event commentary is shown as its own queue, and the cron table derives schedules from `vercel.json`.
- Centralized `/admin/system` queue display metadata in
  `lib/shell/system-queues.ts`; queue names, order, throughput labels, and
  default latency/drift fields now have one tested source instead of inline
  objects inside `getSystemSnapshot`.
- Shared media/content URL ownership predicates through `lib/urls/media.ts`;
  article-body prefetch, YouTube transcript prefetch, enrich claim readiness,
  podcast embeds, and `/admin/system` queue depths now agree on which URLs
  need body prefetch and which X/Twitter rows can skip it before LLM spend.
- Capped scheduled event-level commentary to active 24h events via
  `EVENT_COMMENTARY_CRON_RECENCY_HOURS`; historical event-commentary backlog
  remains visible to operator scripts/backfills but no longer spends every
  cluster cron tick by default.
- Removed the separate `/admin/system` cron cadence path map; cadence labels
  are now inferred from the `vercel.json` cron expressions via
  `lib/shell/system-cron.ts`, so schedule parsing stays out of
  `getSystemSnapshot` and display cannot drift when a cron path changes.
- Shared `/api/admin/iterations/[id]` route-id parsing through `lib/policy/iterations.ts` so fetch/apply/reject stay behaviorally aligned.
- Shared protected-admin route auth, ok/error JSON envelopes, and catch-all
  server-error logging through `runAdminRoute(..., { serverErrorLabel })` in
  `lib/api/admin-route.ts`, wrapping the lower-level `lib/api/admin-auth.ts`
  auth/admin-required response mapping.
- Shared cookie-session route auth and ok/error JSON envelopes for
  required-session user routes (`/api/feedback*`, `/api/tweaks`), plus their
  domain-result mapping and catch-all server-error logging, through
  `runSessionRoute(..., { serverErrorLabel })` in `lib/api/session-route.ts`,
  wrapping the lower-level `lib/api/session-auth.ts` auth-required response.
- Shared the underlying `{ ok: true }` / `{ ok: false, error }` response
  envelope construction through `lib/api/ok-response.ts`; admin/session route
  helpers, auth-denial helpers, and admin login/logout cookie responses now
  reuse that implementation while keeping domain-specific names.
- Shared plain JSON success/error envelopes for small legacy/internal routes
  through `runPlainRoute(..., { serverErrorLabel })` in
  `lib/api/plain-response.ts`; `/api/events/:id/members` and
  `/api/sources/active` no longer hand-copy `Response.json` or catch-all
  `try/catch`/`console.error` server-error branches, and event-member domain
  failures map through `plainRouteResult`.
- Shared active source-picker payload lookup through
  `lib/api/source-catalog.ts`; `/api/sources/active` now keeps only the
  plain JSON/error envelope while the source-catalog helper owns the enabled
  source query, ordering, and compact `{ id, name, kind, group, locale }`
  serializer.
- Shared mutating route JSON body parsing and Zod error-envelope handling through `lib/api/json-body.ts`.
- Shared feedback vote values through `FEEDBACK_VOTES`, `FEEDBACK_SIGNAL_VOTES`,
  and `FEEDBACK_SAVE_VOTE` in `lib/types.ts`, so the DB enum, feedback request
  schema, admin metrics, and saved-item queries cannot drift on `up|down|save`.
- Shared admin session cookie set/clear options through
  `freshAdminSessionCookie` and `expiredAdminSessionCookie` in
  `lib/auth/password.ts`, so login/logout cannot drift on cookie name,
  `httpOnly`, `secure`, `sameSite`, path, or max-age attributes.
- Shared admin login/logout request and response construction through
  `lib/api/admin-session-routes.ts`, so login JSON parsing, password checks,
  next-target sanitization, invalid password envelopes, ok envelopes, and
  Set-Cookie attachment stay out of route leaf files while still using the
  common ok-response helpers.
- Shared admin policy commit request validation and `commitSkillVersion`
  mapping through `lib/api/policy-commit.ts`, so
  `/api/admin/policy/commit` keeps only admin auth, JSON parsing, and response
  mapping.
- Shared admin iteration-run lookup/apply/reject result semantics through
  `lib/api/iteration-routes.ts`, so `/api/admin/iterations/[id]` leaf routes
  keep only admin auth, route-id parsing, and response mapping instead of
  directly importing Drizzle, `iterationRuns`, status tuples, policy commits,
  or cache invalidation.
- Shared admin/v1 saved-collection CRUD result mapping through
  `lib/api/collection-routes.ts`, so both surfaces reuse the same
  `duplicate_name` and `not_found` decisions while keeping their own auth,
  request schemas, and response envelopes.
- Policy editor edit previews now reuse the shared `diffLines` +
  `DiffViewer` contract and register a dirty-draft `beforeunload` guard, so
  policy edits are reviewed against the committed baseline before publishing
  and tab-close protection is covered by a source contract test.
- Policy editor publish/discard confirmations now render inline in the admin
  surface instead of using browser-native `confirm()` dialogs. Covered by
  `tests/policy/policy-editor-source.test.ts`.
- Saved collection create/rename/delete and saved-item removal no longer use
  browser-native `prompt()` / `confirm()` flows. Collection mutations now stay
  in styled inline panels, and collection row action menus render in document
  flow instead of absolute dropdowns that can fall off short viewports.
- Shared saved-item request parsing through `lib/api/saved-requests.ts`;
  `/api/v1/saved` now delegates GET query extraction to
  `parseV1SavedQueryRequest`, while `/api/v1/saved` and
  `/api/feedback/move` reuse the same positive item id, positive collection id,
  inbox-null, locale, and pagination validation instead of carrying
  route-local Zod/query-parser wiring.
- Shared saved-item query defaults and bounds through
  `lib/saved/query-defaults.ts`; `/api/v1/saved` route comments and
  `lib/api/saved-requests.ts` no longer repeat the saved list limit range,
  default page size, or default response locale.
- Shared saved-item route payload semantics through `lib/api/saved-routes.ts`;
  `/api/v1/saved` now delegates saved lookup and agent serialization through
  `listSavedItemsRoutePayload`, `/api/feedback/move` delegates browser saved
  reparenting through `moveSavedItemRoutePayload`, and `/api/v1/saved` plus
  MCP `ax_radar_save` reuse the same save toggle, owner-aware collection
  assignment, assigned-collection response payload, and missing-item
  FK-to-`item_not_found` mapping.
- Shared browser saved-export parsing/rendering through
  `lib/api/saved-export.ts`; `/api/saved/export` now keeps only optional
  cookie-session fallback semantics while the helper owns collection/locale
  parsing, saved item and collection lookup, Markdown shape, deterministic
  filenames, and attachment headers.
- Saved export collection parsing now reuses
  `parseSavedCollectionParam` from `lib/items/saved-collection-selection.ts`,
  so browser export and `/saved` agree on `all`/`inbox`/numeric collection
  semantics and reject partial numeric strings such as `42abc`.
- Shared cookie/v1 tweaks persistence through `lib/api/tweak-routes.ts`, so
  user upsert, preferences/watchlist loading, DB patch construction, and
  `empty_body` decisions stay aligned while each route keeps its own auth and
  response envelope.
- Cookie-gated `/api/tweaks` now delegates shared persistence failures to
  `runSessionRoute(..., { serverErrorLabel })`, matching the other
  required-session routes instead of falling through to the framework's default
  500 response. Covered by `tests/api/tweaks-source.test.ts` and
  `tests/api/session-routes-source.test.ts`.
- Shared watchlist normalization through `lib/watchlist.ts`; browser right-rail
  add/remove flows and cookie/v1 tweak PATCH validation now trim, lowercase,
  and case-insensitively dedupe terms before persistence.
- Derived the site-config tweaks panel option values from the shared
  `TWEAK_*` runtime tuples in `lib/tweaks.ts`, so UI controls, API validation,
  defaults, and browser persistence no longer carry separate enum lists.
- Shared user roles and iteration statuses through `USER_ROLES`,
  `ITERATION_STATUSES`, and named status constants in `lib/types.ts`, so DB
  enums, auth upserts, iteration routes, agent runtime writes, and the admin
  iteration UI cannot drift.
- Shared LLM providers, usage task labels, and reasoning effort labels through
  `LLM_PROVIDERS`, `LLM_TASKS`, and `REASONING_EFFORTS` in
  `lib/llm/types.ts`; provider env parsing and usage ledger writes now validate
  against those runtime tuples before spending or recording cost.
- Shared newsletter kind and locale labels through `NEWSLETTER_KINDS` and
  `NEWSLETTER_LOCALES` in `lib/types.ts`; digest workers, daily-column queries,
  and backfill scripts no longer carry local `daily|monthly` / `zh|en` unions.
- Shared the daily-column writer locale through `DAILY_COLUMN_LOCALE`, so the
  daily writer, daily-column backfill, and AI HOT history importer cannot drift
  on which newsletter locale receives generated columns and payloads.
- Reused `DAILY_COLUMN_LOCALE` in the daily-column renderer, so detail-page
  date formatting, item links, and index links no longer hand-code the Chinese
  route locale.
- Shared daily-column public route construction through
  `lib/daily-column/routes.ts` exports (`DAILY_COLUMN_INDEX_ROUTE`,
  `dailyColumnIssueRoute`, and `dailyColumnItemRoute`), so the daily pages,
  renderer, RSS item links, and installable skill markdown no longer spell
  `/zh/daily` independently.
- Shared AI HOT history placeholder windowing through
  `dailyColumnWindowForDate`, so imported daily payload rows use the same 05:00Z
  period boundaries as the daily-column writer instead of creating midnight
  placeholder rows that would not conflict with the real cron upsert.
- Added `scripts/ops/repair-aihot-daily-windows.ts` as a dry-run-first repair
  path for legacy AI HOT placeholder rows. It only touches rows with no authored
  newsletter fields and `story_count=0`, then moves/merges them onto the same
  daily-column 05:00Z window helper.
- Reused `NEWSLETTER_LOCALES` in the legacy structured-newsletter RSS locale
  parser, so `/api/feed/newsletter/{locale}/rss.xml` cannot drift from the
  newsletter worker/API locale contract.
- Shared newsletter window calculations through `workers/newsletter/windows.ts`;
  daily digest, daily-column selection, monthly digest, and daily-column
  backfill scripts now reuse the same snapped UTC window and period-start
  replay helpers instead of repeating 24h/30d math locally.
- Shared positive route-id parsing through `lib/api/route-params.ts`; item
  detail, event-member, and admin iteration routes now reuse the same coercion
  and `invalid_id` error label.
- Shared REST/MCP search execution and payload serialization through
  `lib/api/search-results.ts`; adapters now own only
  auth/rate-limit/ETag/envelopes, while the helper owns lexical full-match
  totals, semantic source/date/tier filters, and public vs agent
  distance/latency/embedding metadata.
- Shared REST/MCP feed execution and payload serialization through
  `lib/api/feed-results.ts`; adapters now own only
  auth/rate-limit/ETag/envelopes, while the helper owns paired item +
  full-match total queries, pagination defaults, and public vs agent item
  exposure.
- Shared MCP feed/search tool input schemas and default-to-query mapping through
  `lib/api/feed-query-params.ts`; MCP `ax_radar_feed` and
  `ax_radar_search` now use the same source-filter/runtime tuple contracts as
  REST while route handlers stay thin execution/payload adapters.
- Shared feed query defaults and bounds through `lib/feed/query-defaults.ts`;
  REST query schemas, MCP feed mapping, feed execution envelopes, item lookup,
  v1 route comments, installable skill markdown, `/agents` integration copy, and the generated OpenAPI feed docs no longer carry separate
  `featured/archive/40/0/24` defaults or `limit`/hot-window bounds.
- Shared search query defaults and bounds through `lib/search/query-defaults.ts`;
  REST search schemas, MCP search mapping, semantic search fallback execution,
  semantic result offsets, v1 route comments, installable skill markdown, `/agents` integration copy, and generated OpenAPI search docs no longer carry
  separate `lexical/all/20/0/en` defaults or `limit` bounds.
- Shared item-detail lookup and bearer-agent payload construction through
  `lib/api/item-detail.ts`; public routes keep public cache/error mapping,
  while `/api/v1/items/:id` and MCP `ax_radar_get_item` share
  `getAgentItemDetailRoutePayload` and the full `toV1ItemDetail` serializer.
- Shared event-member route payload execution through
  `getEventMembersRoutePayload` / `getEventMembersPayload` in
  `lib/api/event-members.ts`; UI-internal, public, v1, and MCP adapters now
  own only their auth/rate-limit/cache/envelope mapping.
- Shared event-member locale defaults through
  `lib/event-members/query-defaults.ts`; UI-internal, v1, public, MCP, and
  generated OpenAPI event-member surfaces no longer repeat route-local locale
  default literals while preserving their existing per-surface defaults.
- Shared daily-column public lookup payloads and MCP markdown lookups through
  `lib/api/daily-columns.ts`; public daily route files now own only
  rate-limit/cache/error-envelope mapping, while MCP daily resources own only
  resource envelope mapping.
- Shared daily-column public query defaults and bounds through
  `lib/daily-column/query-defaults.ts`; the daily-column API parser,
  generated OpenAPI spec, installable skill markdown, and public dailies route
  comments no longer repeat the `take` range/default or locale default.
- Shared bearer-agent usage summary request parsing and serialization through
  `lib/api/usage-summary.ts`; `/api/v1/usage/summary` and MCP
  `ax_radar_usage` now share the window schema/default plus the same totals,
  `by_task`, `by_model`, and `recent_calls` contract.
- Shared usage window keys through `USAGE_WINDOWS` in `lib/llm/stats.ts`, so
  the admin usage page, v1 usage summary, and MCP usage tool cannot drift on
  the `today|week|month|all` window set or its default `week` behavior.
- Shared admin usage presentation helpers through `lib/llm/usage-display.ts`,
  so range labels, task badge tones, token/call compaction, sparkline dates,
  and task-model summaries stay exhaustive over `USAGE_WINDOWS` and
  `LLM_TASKS` instead of living as page-local switches.
- Shared source kind/group/cadence/source-locale/source-health status runtime tuples through `lib/types.ts` and
  source group display metadata through `lib/sources/groups.ts`, so DB enums
  and the `/sources` group order/labels cannot drift from catalog types.
- Reconciled `scripts/ops/seed-sources.ts` with `lib/sources/catalog.ts` as the
  source of truth: seed now upserts catalog rows and disables enabled DB-only
  orphan source rows, preventing removed sources from staying visible as
  cron-pending work.
- Shared app/source locale tuples and the fetcher-supported source-kind subset
  through `lib/types.ts`, so DB locale enums, REST/MCP locale schemas, sitemap
  locales, and fetcher support checks cannot drift.
- Centralized route-locale defaults and param normalization through
  `DEFAULT_APP_LOCALE`, `isAppLocale`, and `appLocaleFromParam` in
  `lib/types.ts`; feed-like locale pages now normalize once and pass
  `AppLocale` through instead of repeating route-local `locale as "zh" | "en"`
  casts.
- Extended normalized route-locale handling to the remaining locale page
  leaves: admin, agents, sources, daily, login, and podcast detail pages now
  call `appLocaleFromParam` once and pass `AppLocale` through local data
  loading, links, and shell components.
- Replaced component-local `"en" | "zh"` locale prop aliases with shared
  `AppLocale` across shell, feed, saved, X-monitor, admin timeline, agent
  tabs, and tweak-provider UI boundaries.
- Replaced library-local locale unions and aliases with `AppLocale` across
  saved-item queries, public/v1 item serializers, relative-time formatting,
  feedback metrics, ticker loading, usage labels, admin-gate locale parsing,
  and agent iteration prompts.
- Shared item tier, feed view, search mode, and source filter runtime tuples through
  `lib/types.ts`, so REST feed/search schemas, MCP feed/search input schemas,
  item/event commentary workers, score prompt parsing, and source filtering
  cannot drift on `featured|p1|all|excluded`, `today|archive`,
  `lexical|semantic`,
  `source_group`, or `source_kind`.
- Shared the `featured|p1` highlight/deep-dive tier subset through
  `HIGHLIGHT_ITEM_TIERS` and `isHighlightItemTier` in `lib/types.ts`, so
  feed serializers, item/event commentary dispatch, treatment routing, and
  operator backfill scripts no longer repeat that decision locally.
- Shared highlight-tier SQL predicates through `lib/items/tier-sql.ts`, so
  feed/calendar counts, ticker selection, diagnostics, and feedback fixtures
  reuse the same `HIGHLIGHT_ITEM_TIERS` tuple instead of hand-writing
  equivalent two-value `IN` or `OR` clauses.
- Shared home feed tier/view defaults through `lib/feed/home-filters.ts`, so
  the server query parser, home filter UI, all-posts source filter reuse, and
  calendar count filter cannot drift on `featured|p1` or `today|daily`.
- Shared home/all source preset defaults, labels, coercion, and feed-query
  mapping through `lib/feed/source-presets.ts`, so page parsers and
  `HomeFilters` no longer carry app-local `all|official|newsletter|media|x|research`
  lists.
- Shared podcast feed tier defaults/coercion through
  `lib/feed/podcast-filters.ts`, so `/podcasts` no longer carries a local
  `featured|all` tier union or query parser.
- Shared source-catalog view defaults/coercion through `lib/sources/view.ts`,
  so `/sources` and its view toggle cannot drift on `table|cards` or default
  URL behavior.
- Shared public/agent API item source-field types and cluster lead-pick source
  authority types through `SourceGroup` / `SourceKind` from `lib/types.ts`;
  the archived s9 MCP plan is now labeled historical so old enum examples
  are not mistaken for current implementation guidance.
- Shared `/skill.md` and `/openapi.yaml` public contract enums through the same
  `lib/types.ts` runtime tuples, including app/source locales, source
  group/kind/cadence, source-health statuses, item tiers, feed views, and search modes; the source catalog
  description no longer embeds a stale monitored-source count, and MCP
  source-tool copy avoids fixed counts for the same reason.
- Shared public API endpoint metadata through
  `lib/api/public-endpoint-config.ts`, with public route HTTP envelopes
  centralized in `lib/api/public-helpers.ts`; public route handlers now enter
  through `publicCachedRoute(req, { endpoint, etagFamily, label, load })`, while
  `/skill.md`, `/openapi.yaml`, `/agents`, and
  `docs/agent-access/README.md` render or verify the same endpoint count,
  limit labels, and cache policy instead of repeating budgets or 304 wiring.
- Shared public 4xx/5xx envelope mapping through `publicCachedRoute` in
  `lib/api/public-helpers.ts`; anonymous public route files keep domain
  validation/404 decisions local as `{ ok: false, error, status }` results but
  no longer hand-copy rate limits, cache/ETag responses, `publicError`, or
  `console.error` plus `server_error` catch blocks.
- Shared REST query-param extraction and validation plumbing through
  `lib/api/query-params.ts`; public and v1 query routes now reuse one
  Request/URLSearchParams parser while keeping their separate
  `publicInvalidQueryResult` and `v1InvalidQueryResult` envelope adapters.
- Shared public domain-result to cached-route-result mapping through
  `publicRouteResult`; public daily and event-member routes now keep only
  success body/ETag-signal shaping while the public helper maps
  `{ ok: false, error, status }` branches.
- Shared v1 server-error logging/envelope through `runV1Route(..., {
  serverErrorLabel })` in `lib/api/v1-route.ts`; v1 route files keep their
  business 4xx branches but no longer hand-copy `try/catch`, `console.error`,
  or `v1Error("server_error", 500)`.
- Shared admin/v1 domain-result envelope mapping through `adminRouteResult`
  and `v1RouteResult`; collection, saved, event-member, and tweak leaf routes
  now keep only success payload shaping while the surface helpers map
  `{ ok: false, error, status }` branches.
- Shared route payload result types through `lib/api/route-result.ts`; admin,
  session, v1, plain, and public helpers now alias the same ok/error contract
  instead of repeating local `{ ok, payload/error/status }` unions.
- Shared required-session domain-result envelope mapping through
  `sessionRouteResult`; `/api/tweaks` and `/api/feedback/move` now keep only
  success payload shaping while the session helper maps `{ ok: false, error,
  status }` branches.
- Shared plain domain-result envelope mapping through `plainRouteResult`;
  `/api/events/:id/members` now keeps only success payload shaping while the
  plain-response helper maps `{ ok: false, error, status }` branches and
  `runPlainRoute(..., { serverErrorLabel })` owns catch-all server errors.
- Shared admin iteration route adapters through `lib/api/iteration-routes.ts`;
  `/api/admin/iterations/run` now keeps only the route config and
  `runAdminIterationStartRoute`, while `/api/admin/iterations/[id]`, `/apply`,
  and `/reject` keep only the action binding and `serverErrorLabel`. The
  shared helper owns admin auth, route-id parsing, agent-run guard errors,
  catch-all server-error logging, and `adminRouteResult` envelope mapping.
- Shared RSS XML/HTTP response envelope, XML escaping, CDATA splitting, and
  lightweight markdown-to-HTML rendering through `lib/rss/render.ts`;
  `/api/rss/*`, the featured-locale feeds, and the legacy newsletter feeds now
  use the same renderer/response helper while keeping feed-specific metadata
  such as radar extension fields.
- Shared main locale RSS metadata through `lib/rss/main-feed-meta.ts`; the
  featured-locale RSS route, layout alternate links, home RSS button, and
  `/agents` integration cards now reuse one locale/path/title contract.
- Shared main `/api/feed/{locale}/rss.xml` feed construction through
  `lib/rss/main-feed.ts`; the route now owns only locale coercion and the RSS
  HTTP response envelope, matching the legacy and newsletter RSS route shape.
- Shared legacy `/api/rss/{daily,today,curated}.xml` feed construction through
  `lib/rss/legacy-feeds.ts`; the slug route now owns only rate-limit, slug
  validation, 404 handling, and the RSS HTTP response envelope.
- Shared legacy RSS slug metadata through `lib/rss/legacy-feed-meta.ts`; the
  RSS renderer and `/agents` integration page now reuse one slug/path/title
  contract instead of separately hand-writing `/api/rss/*.xml` cards.
- Shared legacy structured newsletter RSS construction through
  `lib/rss/newsletter-feed.ts`; `/api/feed/newsletter/{locale}/rss.xml` now
  owns only locale normalization and the RSS HTTP response envelope.
- Overlaid `/admin/system` cron rows with DB-derived recent activity in
  `lib/shell/system-cron.ts` / `lib/shell/system-stats.ts`; schedules still
  come from `vercel.json`, while jobs without a durable timestamp explicitly
  show `no signal`.
- Shared relative-time display helpers through `lib/time/relative.ts`;
  system cron rows, system source-health notes, daily index rows, and policy
  summary labels now reuse the same date coercion / latest-date / compact-age
  helpers instead of carrying local `ago` variants.
- Shared item tag flattening through `lib/items/tags.ts`; live feed, saved
  stories, item detail, and semantic-search mappers now reuse the same
  capability/entity/topic ordering while keeping their own display caps.
- Shared item locale fallback helpers through `lib/items/localized.ts`; Story
  mappers now reuse the same zh/en/legacy fallback rules for titles,
  summaries, editorial text, source labels, and score reasoning instead of
  hand-writing locale ternaries in each surface.
- Shared Story row mapping through `lib/items/story-mapper.ts`; live feed,
  saved stories, item detail, and semantic-search now keep SQL/query ownership
  local while reusing one tested mapper for source labels, tags, locale
  fallbacks, effective event fields, HKR, coverage, and still-developing state.
- Shared Story DB select aliases through `lib/items/story-select.ts`; those
  same Story surfaces now reuse one item/source field set and one event field
  set instead of copying column aliases into each query.
- Shared admin usage dashboard aggregation through
  `lib/api/usage-summary.ts`; `/admin/usage`, `/api/v1/usage/summary`, and
  MCP usage now all enter through the same summary boundary instead of the
  page importing low-level LLM stat queries directly.
- Shared bearer-gated `/api/v1/*` auth, catch-all server-error handling, and
  plain JSON/error envelopes through `lib/api/v1-route.ts`; v1 route files now
  call `runV1Route` with `serverErrorLabel` and return `v1Json` /
  `v1RouteResult` / `v1InvalidQueryResult`, so token verification, query
  validation envelopes, domain-result failures, and response shape cannot drift
  between agent endpoints.
- Shared agent bearer auth through `lib/auth/api-token.ts` for both
  `/api/v1/*` and `/api/mcp`; v1 routes enter via `runV1Route`, while MCP
  calls `requireApiToken` directly before handing control to the Streamable
  HTTP transport.
- Shared hourly/daily/weekly fetch+normalize sequencing through `workers/fetcher/pipeline.ts`, with HTTP route wiring in `app/api/cron/_fetch-bucket-route.ts` and local cron scripts using the same helper.
- Shared cron HTTP auth/timestamp/JSON envelopes through
  `app/api/cron/_route.ts`, so cron leaf route files only declare static Next
  route config and map worker reports into response payloads.
- Shared article body + YouTube transcript prefetch sequencing through
  `workers/fetcher/content-prefetch.ts`, so `/api/cron/article-body` and
  `bun scripts/ops/run-cron.ts body` use the same production path.
- Shared article-body / YouTube / X-status URL predicates through
  `lib/urls/media.ts`; content-prefetch workers, enrich claim readiness, the
  podcast embed parser, and `/admin/system` body/enrich queue depths now use
  the same source of truth instead of repeating URL `LIKE` patterns.
- Table-drove `scripts/ops/run-cron.ts` through one `CRON_RUNNERS` map and
  exposed all production cron route slugs as `bun run cron:<bucket>` aliases,
  including `fetch-*`, `article-body`, `commentary`, `score-backfill`,
  `cluster`, and newsletter cron tasks; short aliases such as `hourly`,
  `body`, `score`, and `yt` remain available for operators.
- Added an enrich claim readiness gate: normal web items must have
  `body_fetched_at` set before `runEnrichBatch` can claim them, while
  X/Twitter status URLs remain exempt because their adapter already stores
  full tweet text. This prevents the `fetch-hourly :17` / `enrich :20`
  cron ordering from spending LLM tokens before article-body has a chance
  to run.
- Shared enrich-claim reset values through `workers/enrich/claim-state.ts`;
  worker success and operator reset scripts now clear `enrich_claimed_at`,
  `enrich_attempts`, and `enrich_error` from one helper instead of repeating
  the three-field reset object.
- Shared the full cluster Stage A/A.5/B/B+/C/D sequence through `workers/cluster/pipeline.ts`, so `/api/cron/cluster` and `bun scripts/ops/run-cron.ts cluster` no longer drift.
- Stopped a cluster-cron arbitration loop: Stage A and singleton-recluster now
  skip clusters already rejected for the item in `cluster_splits`, preventing
  the same fuzzy join from being re-added and re-split every tick; after three
  distinct rejected clusters, Stage A explicitly settles the item as a
  singleton before running nearest-neighbor probes.
- Added the shared visible-tier SQL gate to cluster Stage A and
  singleton-recluster: `tier='excluded'` rows are no longer clustering
  candidates or neighbors, so recurring low-value items cannot trigger
  arbitration/canonical-title/event-commentary spend. A production preflight
  on 2026-06-19 showed the live Stage A queue would drop from 2 old candidates
  to 0 under the new predicate.
- Moved render-local helper components out of `components/shell/tweaks.tsx`.
- Reworked effect async loading in `SignalDrawer` and `TweaksProvider` to satisfy React lint rules without disabling them.
- Replaced an internal raw `<a>` with locale-aware `next/link`.
- Removed unused imports/locals across app, tests, scripts, and workers.
- Updated stale prompt tests to match the current friend-readable daily-column voice.
- Added `docs/README.md` routing and archive banners for completed daily-column design/plan/handoff docs.
- Updated `docs/reports/code-quality/dead-code-analysis.md` with current Knip commands, cleanup results, and remaining type-review queue.

Verification (2026-06-13):
- `bun run code:dead` — passed.
- `bun run code:dead:exports` — passed.
- `bun run code:dead:types` — passed.
- `bun run lint` — passed with no warnings.
- `bun test --env-file=.env.local` — 786 pass, 1 skip, 0 fail.
- `bun run build` — passed.
- `git diff --check` — passed.

## 2026-06-11 — Enrich spend guardrails, usage all-time/model labels

Current production direction:
- `/admin/usage`, `/api/v1/usage/summary`, and MCP `ax_radar_usage` report `today`, `week`, `month`, and `all` windows.
- Task spend rows include per-model/provider breakdowns; recent calls show provider/model labels.
- Enrich workers must claim rows before LLM calls. Do not reintroduce plain `WHERE enriched_at IS NULL LIMIT n` worker selection for spend-bearing work.

Incident root cause:
- Backfill plus the 15-minute enrich cron left overlapping workers selecting the same `enriched_at IS NULL` rows. The final `UPDATE ... WHERE enriched_at IS NULL` kept storage idempotent, but duplicate workers still paid for repeated `score`, `enrich`, and `embed` calls.
- Stuck rows amplified the issue: DeepSeek schema overflows and a local Azure embedding API-version drift caused retry loops before rows could become enriched.

Shipped code changes:
- Added `items.enrich_claimed_at`, `items.enrich_attempts`, and `items.enrich_error` plus a manual migration.
- `runEnrichBatch` now uses `FOR UPDATE SKIP LOCKED`, stale-claim retry, max attempts, failure recording, and lower default per-tick caps.
- Prompt schemas now truncate/cap overlong arrays and rationale strings instead of failing after successful model output.
- Azure embedding API version is normalized when env accidentally contains `v1`; LLM generate/embed calls have a default 90s timeout.
- Usage admin/API/MCP gained all-time totals, model breakdowns, and recent-call model labels.

Verification:
- Manual DB migration applied to production database and columns verified.
- Focused test suite for enrich claim locking, prompt schema tolerance, usage stats, DeepSeek routing, cron split, and daily-column tests passed.
- `bun run build` passed.
- Targeted ESLint over touched files and `git diff --check` passed.
- Full `bun run lint` still has unrelated pre-existing failures outside this change set.

## 2026-06-10 — DeepSeek treatment rebase, paper retirement, cluster cleanup

Current production direction:
- Prose/scoring defaults moved off GPT-5.5 and onto Azure AI Foundry DeepSeek.
- High-value enrich/commentary/cluster/daily work uses `DeepSeek-V4-Pro`.
- Low-value item treatment and cheap arbitration use `DeepSeek-V4-Flash`.
- Azure OpenAI remains active for `text-embedding-3-large` embeddings and the `gpt-5.5-standard` compatibility/probe deployment.
- The desired editorial voice is "send this to a smart friend": plain, specific, accurate, low translationese, and not memo/jargon-heavy.
- Paper-only sources are retired. Do not re-add arXiv, Hugging Face Papers, Papers with Code, `hf-papers-takara`, `/papers`, `papers.xml`, or `ax-radar://papers`.

Shipped code changes:
- Added `azure-deepseek` provider support in `lib/llm/index.ts`, including Azure Responses-style endpoint normalization, structured JSON parsing, schema retry, and Flash-to-Pro fallback.
- Added treatment routing in `workers/enrich/treatment.ts`; enrich/score/commentary/cluster paths now choose Pro vs Flash by item importance/tier.
- Rewrote Chinese and daily prompts toward friend-sharing language in `workers/enrich/chinese.ts`, `workers/enrich/prompt.ts`, `workers/cluster/prompt.ts`, and `lib/llm/prompts/daily-column.md`.
- Removed paper surfaces from catalog, navigation, sitemap, RSS, MCP, public skill, OpenAPI, and `/papers`.
- Added `scripts/ops/cleanup-paper-sources.ts`, `scripts/ops/backfill-chinese.ts`, and `scripts/ops/backfill-daily-columns.ts`.
- Added singleton reclustering so recent singleton items get another chance to join existing events before duplicate-cluster merge.
- Centralized the canonical public origin in `lib/site.ts` so sitemap, robots, RSS, `/skill.md`, `/openapi.yaml`, and `/agents` share `https://news.ax0x.ai` instead of mixing the production domain with the Vercel alias.

Backfill/DB state verified on 2026-06-10:
- Chinese backfill state: `enrich=14909`, `score=14909`, `commentary=6774`, `clusters=1660`.
- Daily-column backfill: 51 historical daily rows regenerated and self-check-clean.
- Paper cleanup: explicit retired paper sources and arXiv/paper-tagged source rows count `0` in DB after cleanup.
- Empty clusters count `0`.

Verification already run:
- `bun test --env-file=.env.local tests/cluster/singletons.test.ts tests/cluster/merge.test.ts workers/cluster/arbitrate.test.ts tests/llm/deepseek-routing.test.ts tests/enrich/treatment.test.ts tests/enrich/friendly-style.test.ts` — 59 pass.
- Earlier focused suite — 148 pass.
- `bun run build` — passed, route list has no `/papers`.
- Dry runs after backfill: `backfill-style`, `backfill-chinese`, `backfill-daily-columns`, and `cleanup-paper-sources` all returned zero pending targets.

Typecheck gate:
- `bun run typecheck` now passes and covers tests plus Bun runtime APIs. Keep
  this gate green alongside `next build`; do not reintroduce fixture drift that
  only `bun test` happens to tolerate at runtime.

---

# Archived Notes — Session Handoff (2026-04-19/20, Session 8 complete)

> Read this first before resuming. Prior sessions: s1-3 = M0-M2 + RSS/commentary/newsletter/i18n/HKR/bilingual; s4 = Jina body fetch + 晚点 prompts + YT transcripts + `/podcasts`; s5 = M3 auth+feedback+admin-gate + podcast detail + CRON_SECRET; s6 = M4 editorial agent + X ingestion + password gate + 20 broken sources disabled; **s7** = 2026 backfill (+2907 items) + full terminal-aesthetic port of 12 views + named saved-collections + server tweaks sync + 12/14 design-mock divergences closed. **s8 (this one)** = bug triage + admin rebuild + pagination/calendar + YouTube full-coverage pipeline + cleanup of 15 dead sources. Shipped **9 commits** on main (no PR branching this session).

> ### ⭐ Session 9 primary goal: **expose the radar to agents via HTTP API + MCP**
>
> Historical note: at the end of s8, the next planned work was to expose the
> radar to tool-using agents. That plan shipped and is now archived at
> [`docs/AGENT-MCP-PLAN.md`](./AGENT-MCP-PLAN.md). Current agent/API/MCP
> behavior and contributor guidance live in
> [`docs/agent-access/README.md`](./agent-access/README.md).

---

## TL;DR — where the project is at end of session 8

- **Live**: https://news.ax0x.ai
- **Repo**: https://github.com/xingfanxia/newsroom — s8 shipped **9 commits** directly on `main` (no PRs this session; tight iteration with user bug reports). `d350caa → d0b3e17`.
- **Aesthetic**: terminal-forward with HKR ring, accent-green, JetBrains Mono + Noto Sans SC. Admin pages now all match the demo.
- **Auth**: still password-gated via `ADMIN_PASSWORD` env.
- **Data state (end s8)**:
  - **items**: **6821 total · 6803 enriched (99.7%)** · 1337 curated · 2900 with commentary · 5297 with body_md
  - **sources**: **59 total, 43 enabled** (13 fully removed + 2 disabled this session)
  - **feedback**: 10 rows (fixture)
  - **saved_collections**: 0 (nobody used it yet)
  - **policy_versions**: 1 · iteration_runs: 0 (M4 agent still never run through prod UI)
  - **30-day LLM spend**: $443.25 across 68k calls

### Content flow is healthy

- Enrich pipeline caught up: 99.7% enriched (up from 83% at s7 end).
- Commentary pipeline caught up: 2900 items have deep notes (up from 1967).
- YT channels: 110 items, **0 excluded**, 86/110 have full transcripts (see below).

---

## Session 8 shipped

### Round 1 — `d350caa` — data/feed bugs from user's screenshot triage

- **Radar stats showed all 0s** — root cause: drizzle drops the `items.`
  table prefix when a `Date` param is bound, `postgres-js` then rejects
  the ambiguous statement. Fixed with explicit `::timestamptz` casts in
  `getRadarStats`, `getTopTopics`, and `getFeaturedStories` date filter.
  Widget now reports non-zero today / P1 / featured / source metrics again.
- **Radar sweep static + bottom clipping** — SVG `viewBox` expanded to
  `-8 -8 116 116` so HOOK/AUTH/RES/DENSITY labels don't clip. Later bug
  in the same widget (see round 5 below) with the transform origin.
- **Save button inert** — wired to `/api/feedback` with optimistic
  toggle + rollback on 401/fail. Renders `✓ 已收藏` in green when active.
- **Shallow commentary** — `editor_note || editor_analysis` was hiding
  the multi-para analysis behind the one-liner. Now renders both in the
  expand panel as "编辑点评" + "深度解读". Saved-export MD also picks up
  `editor_analysis` + reasoning.
- **Watchlist placeholders** — `DEMO_WATCHLIST` (gpt-6, 盘盘猫 etc.)
  removed; empty state + inline add CTA instead.
- **Home 40 cap / /all 80 cap** — `/all` bumped 80 → 120 default, 500
  when a day is active; also added day-filter URL param.

### Round 2 — `6ae8bf9` — admin pages rebuilt + errored-source cleanup

- **`/admin/usage`** fully rebuilt per `Admin - Usage.html` demo:
  cost-big hero + monthly cap (default $1000 via env) + 30d daily-spend
  SVG sparkline + token-mix hbar tiles + cost-by-task table with share
  bars + cost-by-model table + 25 most recent calls. Range switcher
  via `?range=today|week|month|all` (server-rendered, no client JS needed).
- **`/admin/system`** rebuilt per `Admin - System.html` demo: 4 hero
  tiles (services up / queue depth / errors 24h / cron jobs) + warn
  banner when any enabled source is erroring + services grid from
  `source_health` + queues table (normalize/enrich/commentary/score
  depths) + cron table mirrored from `vercel.json` + 24h error log
  joined from `source_health.last_error`. Spend tables moved out.
- **Terminal CSS ported from demo view.css**: `.tiles/.tile`, `.dt`
  data tables with sticky headers + color variants, `.sd` status dots,
  `.cost-big` split currency, `.progress`, `.hbar`, `.svc-grid`,
  `.svc-card`, `.banner.warn/.info`, `.row-act`, `.mini-btn`. These
  were silently missing which is why admin pages looked wrong.
- **15 errored sources removed**: 13 zero-item (`zhihu-hotlist`,
  `github-trending`, `huxiu-ai`, `jiqizhixin`, `qbitai`,
  `wechat-jiqizhixin-mp`, `sspai-matrix`, `36kr-ai`, `google-deepmind`,
  `xiaomi-research`, `meta-ai`, `thebatch`, `rest-of-world`) fully
  deleted. 2 with items (`36kr-direct` 220 items, `sspai-direct` 99
  items) disabled but preserved. Catalog at `lib/sources/catalog.ts`
  went 71 → 56 entries.

### Round 3 — `d0735c3` — calendar grid + home limit bump

- **New CalendarGrid component** (`components/feed/calendar-grid.tsx`):
  month-view 7-col × N-row grid with activity-scaled accent-green
  cells. Click a day → `?date=YYYY-MM-DD`. Mon-first week order for
  zh convention. Replaces the horizontal DayPicker strip on home + /all.
- **Home limit 40 → 120** default (500 when day is picked). Featured
  page was showing 1/25 of the 981 featured items after the backfill.

### Round 4 — `8c8658a` — healthy classification, monthly cap, calendar polish, pagination

- **Services hero reads 42/43 healthy** not 9/43. Old rule required a
  successful fetch within 2h which mis-flagged every daily + weekly
  source as idle. New rule: cadence-agnostic — healthy = has a
  lastSuccessAt + zero consecutive failures.
- **Monthly cap default 500 → 1000 USD**. Still `USAGE_MONTHLY_CAP_USD`
  env-overridable.
- **Calendar month order** flipped to chronological (prior month left,
  current right).
- **Active calendar cell toggles** — clicking the highlighted day
  clears the `?date=` filter instead of re-navigating.
- **/all paginated**: `?offset=N` driven, `PAGE_SIZE=200`, footer nav
  with `← newer / older →` links. Day-filtered view stays uncapped.

### Round 5 — `6a24167` — daybreak two-dates bug

- `DayBreak` was rendering `2026-04-17 · 星期四  2026年4月16日` for items
  published around UTC midnight. Root cause: ISO half used
  `toISOString()` (UTC) while the CJK half used
  `getFullYear()/getMonth()/getDate()` (local). Rebuilt both from local
  components to match `groupByDay`'s bucket. Also dropped the redundant
  CJK span when EN is selected (bilingual duplication).

### Round 6 — `7030e2d` — /podcasts featured↔all tier toggle

- New tier pill row under the channel pills on `/podcasts`:
  `featured` (curated) vs `all` (includes tier=excluded). URL-state via
  `?tier=all` alongside `?source=<id>`. Limit bumped to 120
  (all-channels) / 300 (per-channel).

### Round 7 — `faff987` — YouTube never excluded

- Hand-picked YT channels (dwarkesh, bestpartners, lex-fridman,
  thevalley101) are interesting in their off-topic episodes too.
  Floor scorer's tier at `'all'` for `source_id LIKE '%-yt'` — low
  importance still sorts below curated AI content but nothing gets
  hidden. Patched both `workers/enrich/index.ts enrichOne()` and
  `workers/enrich/score-backfill.ts`. One-shot DB migration upgraded
  77 previously-excluded YT items. Result: **0 excluded YT items**
  across all 4 channels.

**YT pipeline state end s8**: 110 items total, 106 enriched, 22
featured/p1, 83 in `all` tier, 86/110 with full transcripts (the
remaining 24 split ~12 truly captions-disabled + ~12 thevalley101 auto-
generated zh captions the `youtube-transcript` lib can't parse).
Commentary: 106/106 enriched items have deep notes.

### Round 8 — `d0b3e17` — right-rail layout + sweep origin

- Three bugs same root cause: `.rail-r` is a flex column with
  `height: calc(100vh - 40px)`, panels defaulted to `flex-shrink: 1`,
  and `.panel { overflow: hidden }` (needed for border-radius) chopped
  whatever couldn't fit. Fixed with `.panel { flex-shrink: 0 }` so
  panels keep natural height and the rail's own `overflow-y: auto`
  handles scroll.
- Radar sweep was rotating around the wedge-path's own bounding-box
  center (~67, 28) instead of the radar center (50, 50) because
  `transform-box: fill-box` uses the element's fill-box, not the SVG
  viewBox. Swapped to `transform-origin: 50px 50px` (explicit SVG user
  units).
- Topics cloud capped at 320px internal scroll so it doesn't push
  curation-policy off the rail.

---

## Critical gotchas carried into session 9

1. **Drizzle drops table prefix on Date params** — `items.createdAt >= $1`
   gets SQL-ified as `"created_at" >= $1` (no table qualifier) and
   postgres-js rejects the ambiguous statement. **Always cast Date
   params to `::timestamptz` inline** when mixing with column refs:
   ```ts
   sql`${items.createdAt} >= ${isoString}::timestamptz`
   ```
   Not:
   ```ts
   sql`${items.createdAt} >= ${dateObj}`  // silently fails in prod
   ```
2. **Drizzle-kit push drops HNSW index** because `halfvec_cosine_ops`
   isn't known to drizzle. Always run `bun run db:hnsw` after
   `bun run db:push`. **Still relevant for s9 semantic search work.**
3. **`--font-mono` needs `Noto Sans SC`** in the fallback stack so CJK
   glyphs don't fall back to OS-specific faces.
4. **Resolved 2026-06-12: `getFeaturedStories` has server-side source filters** —
   current callers use `sourceId`, `sourceGroup`, and `sourceKind`; the old
   client-side publisher-name workaround is not current guidance.
5. **M4 agent still must use `reasoningEffort: "medium"`** on Azure
   Pro — xhigh/high hit 5-min ceiling on 12KB prompts.
6. **Tweaks language is URL-derived, never persisted** (see top entry
   2026-07-13). Legacy `"both"` (and any persisted `language`) is dropped on
   load; the UI language always follows the route `[locale]` segment.
7. **Password rotation invalidates cookies** — `ADMIN_PASSWORD` is the
   HMAC key. Feature, not bug.
8. **rsshub.app is dead** — all 8 rsshub sources still disabled.
9. **Commentary `maxTokens = 6144`** + the `<before>/<after>` block in
   `workers/enrich/prompt.ts` is load-bearing.
10. **Vercel env baked at deploy time** — `vercel env add` alone
    doesn't take effect; empty commit + push triggers rebuild.
11. **X billing discipline** — `since_id` cursor on
    `source_health.lastExternalId` keeps steady-state near zero.
    Historical backfills bill per tweet.
12. **Never-exclude tier floor** — `sources.never_exclude=true` + scorer
    `excluded` gets silently upgraded to `'all'` through
    `workers/enrich/source-tier.ts` in both live enrich and
    `runScoreBackfill`. Don't remove without asking operator.

---

## Historical Session 9 priorities (superseded)

### 1. Agent/MCP exposure — shipped
Do not treat this checklist as current work. Current agent/API/MCP behavior
lives in [`docs/agent-access/README.md`](./agent-access/README.md); the
original session-9 design record is archived at
[`docs/AGENT-MCP-PLAN.md`](./AGENT-MCP-PLAN.md).

Original phase outline:
1. HTTP API v1 (read): `/api/v1/feed`, `/api/v1/items/[id]`,
   `/api/v1/sources`, lexical `/api/v1/search`. Bearer auth via new
   `api_tokens` table.
2. HTTP API v1 (write): `/api/v1/saved`, `/api/v1/collections/*`,
   `/api/v1/watchlist`.
3. Semantic search: extend `/api/v1/search?mode=semantic` using
   existing pgvector HNSW on `items.embedding`.
4. MCP server at `/api/mcp` via `@modelcontextprotocol/sdk` Streamable HTTP —
   thin wrapper around shared agent helpers.
5. Claude Code skill at `~/.claude/skills/ax-radar/SKILL.md` with
   domain glossary (tier/HKR/importance semantics).

Historical pre-flight now resolved: `getFeaturedStories` supports per-source
filters, and `/api/v1/feed?source_id=<id>` does not rely on publisher-string
matching.

### 2. M4 agent end-to-end UAT
Still never exercised through prod UI. First iteration remains
available in `/admin/iterations`. Worth running once in s9 to verify
the agent still works post-backfill.

### 3. Key rotation (5+ sessions overdue)
OpenAI/Anthropic/Gemini/Azure/Jina keys have been in chat history
since s3-4. 10 min per provider. Operator hasn't prioritized but it's
sitting.

### 4. Mobile viewport QA
`.m-tabbar` + `.m-drawer` + 720px breakpoint CSS is wired but never
browser-verified. Open DevTools responsive mode + walk through `/`,
`/saved`, `/sources`, `/admin/iterations`.

### Deferred
- **#9 low-follower viral** — feature deferred; the route has been deleted.
  Do not recreate it until source APIs make follower/impression data
  affordable and the product decision is revisited.
- **Tweaks PATCH floods** — rapid theme/accent scrubbing fires 10+
  PATCH requests in a second. Add 500ms debounce.
- **`/admin/users`** still `ComingSoonPanel` — single-user mode so low
  priority until multi-user.

---

## Key files the s9 work will touch

- `db/schema.ts` — add `api_tokens` table (id, user_id, token_hash,
  label, last_used_at, created_at, revoked_at)
- `lib/auth/api-token.ts` — shared bearer-token verifier for `/api/v1/*`
  and `/api/mcp`; use `requireApiToken(req)`
- `app/api/v1/` — new route namespace
- `app/api/mcp/route.ts` — MCP Streamable HTTP endpoint
- `lib/items/live.ts` — add `sourceId` to `FeedQuery`, drop the
  client-side publisher-string workaround on podcasts + x-monitor
- `scripts/ops/mint-api-token.ts` — CLI to issue tokens

---

## Pre-flight for session 9

```bash
cd ~/projects/portfolio/newsroom
git pull --ff-only
vercel env pull .env.local --yes
bun install && bun test
bun run build
bun run db:ping
bun --env-file=.env.local scripts/ops/check-data-state.ts
```

All 5 should return success. Any failure → diagnose before touching API
scaffolding.

---

## Session 8 commit list (all on `main`, no PRs)

```
d0b3e17  fix: right-rail panels stop clipping — sweep origin, flex-shrink, topics scroll
faff987  feat: YouTube sources never go to tier=excluded
7030e2d  feat: /podcasts featured↔all tier toggle
6a24167  fix: daybreak separator no longer shows two different dates
8c8658a  fix: s8 round 4 — healthy classification, monthly cap, calendar order, pagination
d0735c3  feat: s8 round 3 — calendar grid + bump home limit to 120
6ae8bf9  feat: s8 round 2 — admin/usage + admin/system rebuild, errored-source cleanup
d350caa  fix: s8 round 1 — radar data, save button, editor analysis, /all day picker
b0734fa  docs(s8-prep): add pre-built issue punch list for next session  ← s7's last
```
