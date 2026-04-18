# AX's AI RADAR — Session Handoff (2026-04-18, Session 6 complete)

> Read this first before resuming. Sessions 1-3 = M0-M2 + RSS/commentary/newsletter/i18n/cost/perf/HKR/bilingual. **Session 4** = Jina body fetch + 晚点 prompts + per-axis HKR + concurrency fan-out + YouTube transcripts + `/podcasts` UI. **Session 5** = M3 auth+feedback+admin-gate MERGED + podcast detail + CRON_SECRET fix + commentary depth-rewrite x2. **Session 6 (this one)** = M4 editorial agent MERGED · X/Twitter ingestion MERGED · feed source filter + /all sidebar route + /x-monitor real page · Supabase auth ripped out in favour of a password gate · 20 broken/stale/unsupported sources disabled.

---

## TL;DR — where the project is at end of session 6

- **Live**: https://news.ax0x.ai
- **Repo**: https://github.com/xingfanxia/newsroom — session 6 merged **5 PRs** (#5-#9)
- **Brand**: AX's AI RADAR / AX 的 AI 雷达 (cyan on dark observatory)
- **Auth**: password-gated via `ADMIN_PASSWORD` env (magic-link Supabase infra fully removed)
- **Data state**:
  - **items**: 3286 total · **3160 enriched (96%)** · 286 curated (featured/p1) · 604 with commentary · 1602 with body_md
  - **raw_items**: 3316 · 77 just ingested waiting for normalize
  - **sources**: 72 total, **45 enabled**, 27 disabled (0 error, 0 warning — clean)
  - **feedback**: 10 rows (fixture-editor seed from the M4 UAT)
  - **M4 policy_versions / iteration_runs tables**: empty on prod — agent has never been triggered through the UI, only via the local `dry-run-iteration.ts` on the feature branch (gone with the squash-merge)

### The one thing that matters for session 7

**Content volume is not good enough.** Month distribution shows the gap:
```
2026-04: 1216    ← current month, healthy
2026-03:  169
2026-02:   76
2026-01:   67
2025-12:   87
2025-11:   71
2025-10:   76
…
2025-03:   38
```
RSS feeds only expose the last 20-30 items each, so the sparse history is structural — we won't get 2026's worth of content without deliberate backfill (Wayback Machine, sitemap crawling, vendor archive pages). **Priority for session 7 is to design + execute a backfill strategy for all of 2026.** See "Session 7 resume guide" below.

---

## Session 6 shipped — 5 PRs merged

### PR #5 — M4 editorial agent (`e5f0f8c`)

The feedback → editorial-skill rewrite loop. Closes task #37.

**Schema**: `policy_versions` (committed skill history, monotonic `version` per skill, JSONB feedback sample, `committed_by` email) + `iteration_runs` (status='running'|'proposed'|'applied'|'rejected'|'failed', baseVersion, proposedContent, reasoningSummary, agentOutput JSONB). New `iteration_status` enum.

**Skill loader** (`lib/policy/skill.ts`): `getActiveSkill(name)` reads latest from DB, seeds v1 from `modules/feed/runtime/policy/skills/*.skill.md` on first call (race-safe via onConflictDoNothing). `listSkillVersions`, `getSkillVersion`, `commitSkillVersion` complete the API. `workers/enrich/policy.ts` reads via the loader — still uses the 8-char content hash as the scorer's cache key so `items.policy_version` semantics don't change.

**Agent runtime** (`workers/agent/`):
- `prompt.ts` — zod schema: `reasoningSummary` / `changeSummary` / `didNotChange[]` / `proposedContent`. System prompt literally restates the "Iteration discipline" section from inside editorial.skill.md (cap ±15, ≥5 feedback, append dated heuristics, mandatory `didNotChange`).
- `iterate.ts` — `profiles.agent` (Azure pro) with `reasoningEffort: "medium"` override. **xhigh and high both time out at Azure Pro's 5-minute ceiling** when fed 12KB+ prompts with structured output; medium finishes in ~260s and still produces judgment + outside-context + pushback quality (validated in dry-run on the fixture feedback).

**Admin API** — all behind `requireAdmin()` → valid session cookie:
- `POST /api/admin/iterations/run` — kicks off the agent call, `maxDuration=600`
- `GET /api/admin/iterations/[id]` — poll status
- `POST /api/admin/iterations/[id]/apply` — commits to `policy_versions`, invalidates scorer cache
- `POST /api/admin/iterations/[id]/reject` — audit trail

**UI** (`/admin/iterations`): `IterationRunner` client component replaces every mock. `narrativeDiff()` maps agent output onto the DiffViewer (changes → `+` lines, didNotChange → `-` lines with reasons). Sonner toasts on insufficient_feedback / apply success / errors; `router.refresh()` after mutations.

**Dev tools**: `scripts/ops/seed-feedback-fixture.ts` (idempotent 10-row fixture; refuses in production unless `ALLOW_FIXTURE_SEED=1`) + `scripts/ops/dry-run-iteration.ts` (end-to-end agent probe).

**Tests**: 12 new unit (7 diff + 5 prompt/schema). 118 passing, 0 failing.

### PR #6 — X/Twitter ingestion (`71814b0`)

Bearer-auth X API v2 adapter. Tracks 7 handles, ingests original-content tweets into the main feed alongside RSS.

**Handles**:
- Individuals: @dotey · @Khazix0918 · @Yuchenj_UW · @op7418
- Vendor: @AnthropicAI · @claudeai · @OpenAI

**Schema**: `sourceKindEnum += "x-api"`. `source_health += last_external_id` (the since_id cursor — each hourly tick only bills for genuinely new tweets; steady state is typically 0-3 reads/handle).

**Adapter** (`workers/fetcher/x-api.ts`): handle→userId in-memory cache, `exclude=retweets,replies` server-side + defence-in-depth `referenced_tweets` filter, `note_tweet.text` preference for long-form posts, XApiError mapped onto FetchErrorCode.

**Hidden win — `stripHtml` bug fix**: the normalizer was silently dropping every item's body to `""` since M1. linkedom returns `document.body === null` when `parseHTML('<div>…')` lacks a full `<html><body>` skeleton. Fix: plain-text bypass + `<html><body>` wrap + regex-strip fallback. New items now actually populate `items.body` — richer signal density for the scorer going forward.

**Article-body fetcher** skips `x.com/*/status/*` URLs — tweet text already in `items.body`, Jina can't scrape X anyway.

Tests: 25 new (18 x-api mapper + 7 stripHtml). 143 passing.

### PR #7 — Source filter on Hot News + real X Monitor (`c3ce244`)

- `/` header: pill-row source filter (全部 / 官网 / 公众号 / 媒体 / X / 研究) — maps to `(group, kind)` filters via `presetToFilter()`.
- `/x-monitor` replaced the ComingSoon placeholder with a real feed view filtered to `kind=x-api`, `tier="all"`, 60s revalidate.
- `FeedQuery.sourceKind` added alongside existing `sourceGroup`.

### PR #8 — 全部 promoted to sidebar route (`093bec5`)

- New route `/[locale]/all` with tier locked to `"all"`, same source-filter pills as Hot News.
- Sidebar entry 全部 (Newspaper icon) between 热点资讯 and 播客.
- Hot News tier pills drop from 3 to 2: 精选 / P1.
- Legacy `/?tier=all` 307-redirects to `/all` so bookmarks keep working.

### PR #9 — Password gate replaces Supabase Auth (`1327e8e`)

Single operator, single shared password. The magic-link + email-allowlist infra was over-engineered; a signed session cookie is enough and ships without a third-party identity dependency.

**New primitives** (`lib/auth/password.ts`): `mintSessionCookie()` HMAC-SHA256-signs an expiry with `ADMIN_PASSWORD` itself as the key. Rotating the password auto-invalidates every outstanding cookie.

**Session / gate** (`lib/auth/session.ts` + `lib/auth/admin-gate.ts`): `getSessionUser()` reads the cookie and returns a fixed `admin-local` user. `decideAdminGate({hasSession})` simplified — no per-user allowlist.

**Proxy** (`proxy.ts`): synchronous cookie check replaces the Supabase round-trip on every admin request (no more session-cookie rotation merge).

**Routes**: `/login` is a password form. `POST /api/admin/auth` sets the cookie. `POST /api/admin/logout` clears it. Sidebar 退出 button wired.

**Removed**:
- `lib/auth/supabase/{client,server,proxy}.ts`, `lib/auth/config.ts`
- `app/api/auth/callback/route.ts`, `app/[locale]/403/page.tsx`
- `@supabase/ssr`, `@supabase/supabase-js` from package.json
- `tests/auth/config.test.ts`

**Kept**: `users` + `feedback` tables — votes still attribute to a user row (the fixed `admin-local` user, seeded on demand via `upsertAppUser`).

**Env**: `ADMIN_PASSWORD=xiaofei0214` set in all 3 Vercel envs (production / preview / development).

Tests: 117 passing; added 11 for password compare + cookie sign/verify round-trip including tamper, expiry, password-rotation invalidation.

### Supplementary — source catalog cleanup (this session, post-merge)

20 sources disabled with explanatory `notes`:

- **rsshub.app 403-blocks us entirely** — 8 sources: xiaomi-research, 36kr-ai, huxiu-ai, sspai-matrix, jiqizhixin, qbitai, zhihu-hotlist, wechat-jiqizhixin-mp. Alternatives (jiqizhixin-w2r, qbitai-w2r, huxiu-feedx, 36kr-w2r, sspai-direct) are enabled where available.
- **Direct RSS URLs gone** — 3 sources: thebatch (`/feed/` 404), meta-ai (`/blog/rss/` 404), rest-of-world (JS redirect to /lander).
- **Bot-walled** — 1 source: github-trending (`.atom` returns HTML now).
- **Stale-but-returning-200** (fetcher sees ok, but feed hasn't updated in months/years) — 5 sources: microsoft-ai (since 2022), coolshell-cn (author passed away), huxiu-feedx (since Aug 2024), jiemoren-macro-w2r (since Jan 2025), thepaper-feedx (stale 4 months).
- **Unsupported `kind`** — 5 sources: anthropic-news, huggingface-papers, hf-trending-models, deepseek-hf, qwen-hf. These have `kind: "scrape" | "api"` which the fetcher doesn't implement yet. Re-enable after building those adapters.

All 45 still-enabled sources run clean: 0 errors / 0 warnings on the last hourly + daily fetch pass.

**New tool**: `scripts/ops/disable-broken-sources.ts` — idempotent patcher that flips `enabled: true → false` + appends notes for a hard-coded list of IDs. Run it after adding new broken sources to the list, then `bun scripts/ops/seed-sources.ts` to apply to the DB.

---

## Session 7 resume guide — backfill 2026

### The target

Fill in the data gap for the entire **calendar year 2026** across the 45 enabled sources. Ideally the feed should show 500+ items/month for every month of 2026, not the current Apr-loaded shape.

### Strategies (in rough order of viability)

1. **Wayback Machine for RSS feeds**: Internet Archive snapshots preserve older feed contents. For any enabled RSS source, query `http://web.archive.org/web/<YYYYMM>000000*/<feed-url>` via CDX API → get every snapshot of the feed for each month → parse each one → dedup via `raw_items.external_id`. This is by far the cheapest backfill path for RSS. Most of our sources have Wayback coverage.

2. **Vendor archive / sitemap pages**: Some feeds (anthropic.com/news, openai.com/blog, deepmind.google) have paginated or sitemap endpoints. Scrape once, enqueue per-item URLs, hand to Jina Reader for body. This requires the `kind: "scrape"` adapter (currently disabled — see pending sources above).

3. **Direct URL enumeration**: For vendor-official blogs with predictable URL patterns (e.g. `blog.google/technology/ai/YYYY/MM/...`), crawl known index pages.

4. **X historical**: X API v2 has `/users/:id/tweets` paginated via `pagination_token`. Cost per historical tweet is the same as a fresh one. For the 7 handles, 365 days × ~5 original tweets/day ≈ 12.8k reads/handle × 7 = 90k reads. On pay-as-you-go that's real money — **confirm X plan tier before running**. Consider capping to last 90 days per handle.

### Suggested execution

- **Write a per-source backfill runner** at `scripts/ops/backfill-source.ts` that takes `(sourceId, fromDate, toDate)` and uses the appropriate strategy. Start with strategy #1 (Wayback) since it's free and covers the most sources.
- **Run locally against the remote DB** — the project's `.env.local` points at the prod Supabase URL, so `bun scripts/ops/backfill-source.ts …` writes directly. This is far faster than waiting for Vercel cron ticks (hourly ≈ 15 min for a full cycle) and lets you interrupt / resume as needed. The user specifically suggested this fallback if Vercel is too slow.
- **Normalizer + enrich cascade is the same** — once items land in `raw_items`, the existing cron handles normalize → body_md → score → commentary.
- **Cost awareness** — 2000+ new items × ~$0.003 Azure enrich + ~$0.01 scoring + ~$0.002 Jina body + ~$0.004 commentary (only for curated) ≈ **$40-60 for a full 2026 backfill**. Budget before kicking off.
- **Checkpointing**: store `last_backfilled_at` per source somewhere (either in `sources.notes` or a new column) so re-runs pick up where they left off rather than re-hitting the archive.

### Verifying the result

- Re-run the month-distribution query from `scripts/ops/check-data-state.ts` (write this script fresh if it doesn't exist — see the query in this doc's "Data state" section).
- Target: every month 2026-01 through 2026-04 has ≥ 500 items.
- Scorer will run against the new items automatically on the next `/api/cron/enrich` tick. Expect ~280/hr drain rate once the queue builds up.

### Before starting

```bash
cd ~/projects/portfolio/newsroom
vercel env pull .env.local --yes       # pick up any env-var additions
bun install && bun test && bun run build
bun run db:ping
curl -s -H "Authorization: Bearer $CRON_SECRET" https://news.ax0x.ai/api/cron/normalize | head -3
```

Read first:
- `modules/feed/runtime/policy/skills/editorial.skill.md` — the curation rubric; understanding it helps you judge whether a backfilled item is worth enriching
- `workers/fetcher/index.ts` and `workers/fetcher/rss.ts` — current ingest path; the backfill script should reuse the same `FeedItem → rawItems` insert logic

Open questions for the user before implementation:
- Which tier of X API are we on? (Free tier = 10k reads/month — we'd blow this immediately with backfill.)
- Budget for the Azure/Jina spend on a full 2026 enrich?
- Do we care about 2025-before content or just 2026-01 onwards?

---

## Key gotchas carried forward

1. **Password rotation invalidates cookies** — `ADMIN_PASSWORD` is the HMAC key; rotating it signs out every admin instantly. Feature, not bug. Documented in `lib/auth/password.ts`.

2. **M4 agent: reasoningEffort must be "medium" on pro** — xhigh/high + 12KB prompt + structured output = hard 5-min Azure ceiling. If quality regresses on more complex skills, try shortening the prompt before touching reasoning.

3. **Commentary maxTokens = 6144, not 3072** — the depth rewrite in PR #4 (session 5) needs the headroom. Don't cut.

4. **Commentary prompt's `<before>/<after>` block is load-bearing** — prescriptive rules alone produce AI-templated output; the demonstration is what makes the prompt work. See `workers/enrich/prompt.ts` and `feedback_prompt_prescription_vs_demonstration.md` memory.

5. **stripHtml was broken for 4 months** before PR #6 fixed it — every pre-#6 item has `body=""`. Items ingested after #71814b0 have real bodies. If signal density for older items feels weak, that's why — consider a backfill job to re-run the normalizer on old rawItems (but the rawPayload still has the content, so `body` can be re-extracted).

6. **rsshub.app is dead to us** — free mirror 403-blocks our User-Agent. All `kind: "rsshub"` sources are now disabled. Self-hosting an RSSHub instance is an option (Docker image exists) but wasn't done this session.

7. **X pay-per-tweet cost discipline** — the `since_id` cursor is load-bearing for steady-state cost. First tick after a cold deploy pays ~20 tweets × 7 handles = 140 reads; subsequent ticks drop to 0-3 per handle. If monthly bill jumps, check cursor persistence.

8. **Vercel env changes require redeploy** — pattern validated across `CRON_SECRET` (s5), `X_BEARER_TOKEN` (s6-PR#6), `ADMIN_PASSWORD` (s6-PR#9): `vercel env add …` in all three envs + an empty commit to trigger a rebuild. Values are baked at build time; a running function won't see a newly-added env var without a redeploy.

9. **Azure reasoning throttle** still binds — `reasoning_effort: "high"` caps at ~6-7 calls/min on the standard deployment. See `feedback_azure_reasoning_throttle.md`.

10. **Key rotation still pending** — OpenAI/Anthropic/Gemini/Azure/JINA keys have been in chat history since sessions 3-4. This has been deferred across three sessions now. Rotating is a 5-minute task per vendor. If the next session is exclusively the backfill project, bundle key rotation in as the first 10 minutes.

---

## Task list state

### Pending (checked against `TaskList` at end of s6)

Everything on TaskList from prior sessions is either **completed** or was never a real task. Remaining work lives in "Session 7 resume guide" above. No new `TaskCreate` entries needed — the user's direction for s7 is a focused sprint on content backfill.

### What's NOT yet built (for future sessions, not s7)

- **Search on `/`** — header has a disabled "Coming soon" input. Full-text search over `items.title + body` via pg `tsvector`.
- **`/admin/system` real dashboard** — currently ComingSoon. Should show: cron last-run timestamps, hourly/daily ingest rate, enrich queue depth, LLM cost for the week, source_health overview.
- **`/admin/users` real page** — ComingSoon. In password-gate mode there's exactly one user, so this is mostly cosmetic for now. Re-evaluate if/when multi-user returns.
- **`/saved`** — ComingSoon. Requires `feedback.vote='save'` rows surfaced as a per-user feed.
- **`/low-follower`** — ComingSoon. The original "low-follower viral" concept from the architecture doc — hasn't been scoped.
- **`scrape` + `api` adapter kinds** — would unlock anthropic-news, huggingface-papers, hf-trending-models, deepseek-hf, qwen-hf. Nice-to-have, not critical.
- **Remove Supabase env vars from Vercel** — they're unused now (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`). Harmless but clutters `vercel env ls`.

---

## Dev operations quick-ref

### Running the ops scripts

```bash
# Check data state
bun --env-file=.env.local -e 'import("./db/client").then(async m => {
  const {items,sources,rawItems,feedback} = await import("./db/schema");
  const {sql} = await import("drizzle-orm");
  const [it] = await m.db().select({total: sql`count(*)`.mapWith(Number), enriched: sql`count(*) filter (where enriched_at is not null)`.mapWith(Number)}).from(items);
  console.log("items:", it);
  await m.closeDb();
})'

# Re-seed catalog
bun --env-file=.env.local scripts/ops/seed-sources.ts

# Disable new broken sources (edit the list at top of the file, then run)
bun scripts/ops/disable-broken-sources.ts && bun --env-file=.env.local scripts/ops/seed-sources.ts

# Trigger a manual fetch cycle
bun --env-file=.env.local -e 'import("./workers/fetcher").then(async m => {
  const r = await m.runFetchBucket(["hourly", "daily"]);
  console.log(r);
  const {closeDb} = await import("./db/client"); await closeDb();
})'

# Seed feedback fixture (dev only; refuses in production unless ALLOW_FIXTURE_SEED=1)
bun --env-file=.env.local scripts/ops/seed-feedback-fixture.ts

# Dry-run the M4 agent against current feedback (no UI required)
bun --env-file=.env.local scripts/ops/dry-run-iteration.ts

# Probe X timeline for one handle
bun --env-file=.env.local scripts/ops/probe-x-timeline.ts dotey
```

### Vercel env management

```bash
vercel env ls                                            # list all (masked)
vercel env pull .env.local --yes                         # sync local
printf '%s' "$VALUE" | vercel env add NAME production    # add (no-newline pipe)
# Then: git commit --allow-empty -m "chore: redeploy" && git push
```

---

## Memory files auto-loaded per session

Living at `~/.claude/projects/-Users-xingfanxia-projects-portfolio/memory/`:

- `project_newsroom_state.md` — session-by-session state snapshot (update this on every session wrap)
- `feedback_azure_reasoning_throttle.md` — Azure reasoning-effort cost/time limits (includes s6's pro-deployment 5-min ceiling finding)
- `feedback_cron_secret_gotcha.md` — Vercel env-baked-at-deploy-time pattern
- `feedback_prompt_prescription_vs_demonstration.md` — commentary prompt lesson
- `feedback_yage_romanization.md` — 鸭哥 != 杨格
- `feedback_current_gen_models.md` — use Claude 4.x / Gemini 3.x / GPT-5.x
- `feedback_secret_handling.md` — API keys go to .env.local, never git
- `feedback_image_reading.md` — screenshots readable via Read directly
- `project_azure_resources.md` — two Azure resources (standard + pro) endpoint shapes
- `project_portfolio_layout.md` — newsroom is one sibling among several in `portfolio/`

New this session: none — all session-6 learnings (password gate, stripHtml bug, rsshub death, Azure Pro 5-min ceiling) are captured here in HANDOFF rather than as separate memories.

---

## Archive: pre-session-6 history

For the detailed record of what M0-M3 + sessions 1-5 shipped, see the git log:

```bash
git log --oneline --grep='feat' --since='2025-12-01' --until='2026-04-17'
```

Key prior-session milestones:
- **M0-M1 (sessions 1-2)**: ingest pipeline + normalizer + HNSW clustering + basic UI
- **M2 (session 2-3)**: editorial scoring + commentary + newsletter + bilingual + cost tracking
- **M3 (session 5)**: auth+feedback+admin-gate (now superseded by password gate in s6)
- **Jina Reader body fetch**: session 4
- **YouTube transcripts + /podcasts UI**: session 4-5
- **晚点-tone commentary**: session 4, rewritten for depth in session 5
- **Vercel CRON_SECRET fix**: session 5 (crons were silently 500-ing since M1)

End of session 6 handoff.
