# AX's AI RADAR — Current Handoff

## 2026-06-12 — Code-quality and docs source-of-truth cleanup

Current maintenance direction:
- Start docs navigation from `docs/README.md`; historical plans/handoffs are useful context, not current implementation instructions.
- `bun run lint` is expected to be clean with zero warnings.
- `bun run code:dead` is the low-noise Knip gate for unused files/dependencies/unresolved imports and should exit cleanly. Use `bun run code:dead:exports` separately for manual export-boundary review.
- `upsertAppUser(user)` upserts the effective user row, including API-token users, before FK-owned mutations.

Shipped cleanup:
- Added repo-specific `knip.json` entry/project patterns for Next routes, tests, workers, scripts, and config files.
- Removed unused UI/source-row components, the unused Tavily integration stub, and unused direct package dependencies.
- Replaced stale `tsx` operator-script hints with `bun`.
- Updated README / `.env.example` / architecture docs so Tavily is not advertised as wired, cron docs match the current split route set, and cluster docs match the 0.75 / 72h runtime.
- Moved render-local helper components out of `components/shell/tweaks.tsx`.
- Reworked effect async loading in `SignalDrawer` and `TweaksProvider` to satisfy React lint rules without disabling them.
- Replaced an internal raw `<a>` with locale-aware `next/link`.
- Removed unused imports/locals across app, tests, scripts, and workers.
- Updated stale prompt tests to match the current friend-readable daily-column voice.
- Added `docs/README.md` routing and archive banners for completed daily-column design/plan/handoff docs.
- Updated `docs/reports/code-quality/dead-code-analysis.md` with current Knip commands, cleanup results, and remaining export-review queue.

Verification:
- `bun run code:dead` — passed.
- `bun run lint` — passed with no warnings.
- `bun test --env-file=.env.local` — 505 pass, 0 fail.
- `bun run build` — passed.
- `git diff --check` — passed.

## 2026-06-11 — Enrich spend guardrails, usage all-time/model labels

Current production direction:
- `/admin/usage` and `/api/v1/usage/summary` report `today`, `week`, `month`, and `all` windows.
- Task spend rows include per-model/provider breakdowns; recent calls show model labels.
- Enrich workers must claim rows before LLM calls. Do not reintroduce plain `WHERE enriched_at IS NULL LIMIT n` worker selection for spend-bearing work.

Incident root cause:
- Backfill plus the 15-minute enrich cron left overlapping workers selecting the same `enriched_at IS NULL` rows. The final `UPDATE ... WHERE enriched_at IS NULL` kept storage idempotent, but duplicate workers still paid for repeated `score`, `enrich`, and `embed` calls.
- Stuck rows amplified the issue: DeepSeek schema overflows and a local Azure embedding API-version drift caused retry loops before rows could become enriched.

Shipped code changes:
- Added `items.enrich_claimed_at`, `items.enrich_attempts`, and `items.enrich_error` plus a manual migration.
- `runEnrichBatch` now uses `FOR UPDATE SKIP LOCKED`, stale-claim retry, max attempts, failure recording, and lower default per-tick caps.
- Prompt schemas now truncate/cap overlong arrays and rationale strings instead of failing after successful model output.
- Azure embedding API version is normalized when env accidentally contains `v1`; LLM generate/embed calls have a default 90s timeout.
- Usage admin/API/MCP gained all-time totals and model breakdowns.

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

Known caveat:
- `bunx tsc --noEmit` still fails because repo test typing does not expose `bun:test` types and an existing `tests/auth/feedback-schema.test.ts` Drizzle nullable fixture issue remains. `next build` type-checking passes.

---

# Archived Notes — Session Handoff (2026-04-19/20, Session 8 complete)

> Read this first before resuming. Prior sessions: s1-3 = M0-M2 + RSS/commentary/newsletter/i18n/HKR/bilingual; s4 = Jina body fetch + 晚点 prompts + YT transcripts + `/podcasts`; s5 = M3 auth+feedback+admin-gate + podcast detail + CRON_SECRET; s6 = M4 editorial agent + X ingestion + password gate + 20 broken sources disabled; **s7** = 2026 backfill (+2907 items) + full terminal-aesthetic port of 12 views + named saved-collections + server tweaks sync + 12/14 design-mock divergences closed. **s8 (this one)** = bug triage + admin rebuild + pagination/calendar + YouTube full-coverage pipeline + cleanup of 15 dead sources. Shipped **9 commits** on main (no PR branching this session).

> ### ⭐ Session 9 primary goal: **expose the radar to agents via HTTP API + MCP**
>
> Operator asked to expose the radar to tool-using agents (Claude Desktop, custom bots) at end of s8. **Read [`docs/AGENT-MCP-PLAN.md`](./AGENT-MCP-PLAN.md)** for the full design: two-surface architecture (HTTP API as source of truth, MCP as thin adapter), Bearer-token auth, rollout phases. Estimated ~1 full session if focused.

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
  Widget now reads 3182 today / 71 P1 / 981 featured / 45 sources.
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
  via `?range=today|week|month` (server-rendered, no client JS needed).
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
4. **`getFeaturedStories` has no per-source filter** — only
   `sourceGroup` / `sourceKind`. `/x-monitor?handle=X` and
   `/podcasts?source=X` emulate filtering via client-side
   `s.source.publisher` matching (string equality on publisher name).
   Fragile if two sources share a publisher name. **Fix this in s9
   before exposing `/api/v1/feed` with per-source params.**
5. **M4 agent still must use `reasoningEffort: "medium"`** on Azure
   Pro — xhigh/high hit 5-min ceiling on 12KB prompts.
6. **Tweaks localStorage migration** — legacy `"both"` language auto-
   normalises to `"en"`. Removed from UI in s6.
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
12. **YT tier floor** — `source_id LIKE '%-yt'` + scorer `excluded`
    gets silently upgraded to `'all'` in both `enrichOne` and
    `runScoreBackfill`. Don't remove without asking operator.

---

## Session 9 priorities (in order)

### 1. Agent/MCP exposure — primary goal
Full design in [`docs/AGENT-MCP-PLAN.md`](./AGENT-MCP-PLAN.md). Phases:
1. HTTP API v1 (read): `/api/v1/feed`, `/api/v1/items/[id]`,
   `/api/v1/sources`, lexical `/api/v1/search`. Bearer auth via new
   `api_tokens` table.
2. HTTP API v1 (write): `/api/v1/saved`, `/api/v1/collections/*`,
   `/api/v1/watchlist`.
3. Semantic search: extend `/api/v1/search?mode=semantic` using
   existing pgvector HNSW on `items.embedding`.
4. MCP server at `/api/mcp/sse` via `@modelcontextprotocol/sdk` —
   thin wrapper, ~300 LOC.
5. Claude Code skill at `~/.claude/skills/ax-radar/SKILL.md` with
   domain glossary (tier/HKR/importance semantics).

Before starting: **fix `getFeaturedStories` per-source filter** so
`/api/v1/feed?source=<id>` doesn't rely on publisher-string matching.

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
- **#9 `/low-follower` route** — still blocked on X Pro tier for
  `/2/tweets/search/all`. Either pay or delete the route.
- **Tweaks PATCH floods** — rapid theme/accent scrubbing fires 10+
  PATCH requests in a second. Add 500ms debounce.
- **Policy editor loses drafts on tab close** — no `beforeunload` handler.
- **Native `confirm()`/`prompt()` in collection CRUD** — ugly on mobile.
- **`/admin/users`** still `ComingSoonPanel` — single-user mode so low
  priority until multi-user.

---

## Key files the s9 work will touch

- `db/schema.ts` — add `api_tokens` table (id, user_id, token_hash,
  label, last_used_at, created_at, revoked_at)
- `lib/auth/api-token.ts` — new middleware, `verifyApiToken(req)`
- `app/api/v1/` — new route namespace
- `app/api/mcp/sse/route.ts` — MCP SSE endpoint
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
