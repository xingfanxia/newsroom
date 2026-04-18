# AX's AI RADAR — Session Handoff (2026-04-18, Session 5 complete)

> Read this first before resuming. Sessions 1-3 = M0-M2 + RSS/commentary/newsletter/i18n/cost/perf/HKR/bilingual. **Session 4** = Jina body fetch + 晚点 prompts + per-axis HKR + concurrency fan-out + YouTube transcripts + `/podcasts` UI. **Session 5 (today) = M3 auth+feedback+admin-gate MERGED · podcast detail page with transcript+deep-take MERGED · Vercel cron UNBRICKED (CRON_SECRET was never set, crons 500-ing since M1) · commentary prompt rewritten twice for depth · 160 curated items regenerated.** Only M4 pending.

---

## TL;DR

- **Live**: https://news.ax0x.ai · **new**: `/[locale]/podcasts/[id]` detail pages with YouTube embed + deep take + transcript
- **Repo**: https://github.com/xingfanxia/newsroom — **4 PRs merged in s5** (#1 M3 · #2 podcast-detail · #3 commentary-tone-v1 · #4 commentary-depth-v2)
- **Brand**: AX's AI RADAR / AX 的 AI 雷达 (cyan on dark observatory)
- **Done through s5**: everything above + **Supabase Auth + feedback capture + admin gate + podcast detail + react-markdown renderer + cron actually running for the first time ever + commentary has judgment+outside-context+pushback (not just fact-recap)**
- **Pending**: **M4 editorial agent** (`/mtc`, task #37) · key rotation (OpenAI/Anthropic/Gemini/Azure/JINA from ss3-4)
- **Data state end of s5**: ~300/2822 enriched (cron draining at ~280/hr — scheduled cron was 0/hr before the CRON_SECRET fix; all prior drain was local scripts) · **160 curated items with depth-rewrite commentary** · 5 podcasts with full transcripts+analyses on `/[locale]/podcasts/[id]`

---

## Session 5 shipped (2026-04-17→18 — 4 PRs + 1 ops fix)

### PR #1 — M3: feedback + Supabase auth + admin gate (merged via squash)

5-phase tier-4 big-task. Closes #36 + #45.

**Schema:** `users` + `feedback` tables + `user_role` / `feedback_vote` enums; unique `(item, user, vote)` toggle index; FK cascades. Applied via `db:push --force` + HNSW rebuild.

**Auth:** `@supabase/ssr@0.10.2` + `@supabase/supabase-js@2.103.3`. `lib/auth/{config,session}.ts` + `lib/auth/supabase/{server,client,proxy}.ts`. `/login` magic-link + `/api/auth/callback` with sanitised `?next=` (blocks open-redirect via `//` or `/api`).

**Feedback API:** `POST /api/feedback` with zod body (itemId, vote, on, optional note), 401 when unauth, upserts app-user row on first vote. `lib/feedback/toggle.ts` transaction-safe up/down mutual exclusion; save independent.

**UI wiring:** `components/feed/feedback-controls.tsx` rewritten — optimistic toggle mirrors server mutual-exclusion, rollback on error, sonner toast on 401 with "Sign in to vote" action routing to `/login?next=<current>`. `layout.tsx` mounts `<Toaster />`.

**Admin metrics:** `lib/feedback/metrics.ts` → `getFeedbackCounts()` (up/down/save GROUP BY) + `getRecentFeedback(locale)` (items join for locale-aware titles). `/admin/iterations` drops `mockFeedback` entirely.

**Admin gate:** `lib/auth/admin-gate.ts` pure `decideAdminGate({pathname, user})` returns `allow | redirect` — unit-testable. `proxy.ts` composed with next-intl: `/[locale]/admin/*` pre-filtered via regex, only then hits Supabase (keeps public feed fast). Cookie rotation merged into both redirect + pass-through. `/403` page surfaces signed-in email. `ALLOWED_ADMIN_EMAILS` fails closed to `xingfanxia@gmail.com`.

**Tests:** 36 new (82 total, 0 failing).

### PR #2 — podcast detail page

Shareable `/[locale]/podcasts/[id]`. Rebased onto M3 main (package.json + bun.lock conflicts resolved, both dep sets kept).

- `lib/items/detail.ts` — `getItemDetail(id, locale)` one-item join with `body_md` + `body_fetched_at`
- `components/markdown/prose.tsx` — single `<Prose>` wrapping `react-markdown@10` with design-system tokens (reusable for M4 newsletter + agent output)
- `components/podcasts/transcript.tsx` — client-side collapsible (default closed, max-h 640 scroll)
- `components/podcasts/youtube-embed.tsx` + `extractYouTubeId` — handles `/watch?v=`, `youtu.be/`, `/shorts/`, `/embed/`, `m.youtube.com`. **10 unit tests.**
- `story-card.tsx` +9 lines: conditional "深度解读 + 字幕 →" link only when `source.group === 'podcast'`
- Deps: `react-markdown@10.1.0` + `remark-gfm@4.0.1` (~45KB gzipped, detail route only)

### Ops fix — Vercel CRON_SECRET (direct to main, `1e05077`)

**Root cause:** `app/api/cron/_auth.ts` returns 500 `{"error":"cron_secret_unset"}` when `CRON_SECRET` is unset in non-dev. That env var was **never added** to any Vercel environment. **All scheduled crons have been 500-ing silently since M1 shipped (commit `2b68eea`, Dec 2025.)** Every "backfill progress" attributed to cron was actually interactive `bun scripts/ops/run-cron.ts` runs from local shell.

**Fix:** `openssl rand -hex 32` → `vercel env add CRON_SECRET {production,preview,development}` → empty commit to trigger redeploy (Vercel bakes env at deploy time). No code change.

**Confirmed:** `/api/cron/normalize` → 200; 888 LLM calls + 47 items enriched in 10 min; sustained ~280/hr matching original estimate.

**Memory:** `feedback_cron_secret_gotcha.md` added.

### PR #3 — commentary tone v1 (drop structural prescriptions)

**Problem:** session 4's "晚点-tone rewrite" turned structural rules into new clichés — `真正值得盯的是 X` / `真正 X 是 Y, 不是 Z` / `接下来 30 天先盯` / `过去 3 个月` / mandatory `## 判断式小标题` / numbered signal endings appeared in every output.

**Fix:** banned those 10+ phrases, dropped mandatory section headings, added inline zh `<before>/<after>` example, default 300-600 字, first-person allowed.

**Result:** regenerated 142 items in 104 s, 0 errors. Templates gone. **But shallow** — model read "tell a friend what you noticed" as "recite the article's facts".

### PR #4 — commentary tone v2 (demand depth)

**Problem:** v1 output was 400-600 字 of fact-paraphrase with no thesis, no outside context, no pushback.

**Fix — three mandatory moves for strong material:**
1. **First paragraph = judgment**, not recap. Prompt contrasts `"Anthropic 发布 X, 价格维持 Y..."` (bad) with `"Anthropic 这次很克制..."` (good).
2. **One outside-article comparison** from training knowledge — specific competitors / prior launches / historical parallels / prior earnings commentary / related research papers. With uncertainty hedges (`"I'm not 100% sure but..."`); never invent.
3. **One pushback** against the article/narrative/source. `"正文没给 X"` is stenography, not pushback — demand `"I have doubts because..."`.

Plus:
- Length 800-1400 zh / 600-1000 en default — `"length follows depth, material 撑得住就写长"`
- `editorNote` ≤200 chars with explicit "must have a stance"
- Full `<before>/<after>` example at 1100+ 字, with annotations under `<after>` calling out exactly what made it work
- `commentary.ts` `maxTokens: 3072 → 6144` (schema truncation fix)

**Regenerated all 160 curated items in 378 s, 0 errors.** Huang Moat sample (1300 字): opens `"我最买账的一半是供给控制，最不买账的一半是电子到token那套诗意包装"`, cites AMD MI300 / Google TPU / AWS Trainium / Cursor rules from training, pushes back with `"只有 Nvidia 能做这句我不买"`.

**Memory:** `feedback_prompt_prescription_vs_demonstration.md` added — **the `<before>/<after>` block in `workers/enrich/prompt.ts` is load-bearing**. Don't cut it in future refactors without replacing with equivalent demonstration.

---

## Session 6 resume guide

Only **one** task pending: `/mtc` for M4 editorial agent (task #37).

**The agent should:**
- Read feedback rows (`lib/feedback/metrics.ts` has `getFeedbackCounts()` + `getRecentFeedback(locale)` already)
- Load current `editorial.skill.md` (the curation policy read by the scorer)
- Propose a new version via structured LLM call (profiles.agent — pro + xhigh)
- Show diff + version history on `/admin/iterations` (agent-console + diff-viewer UI components already exist, currently wired to mocks)
- Commit new version atomically; old version recoverable via git

Everything else is shipped:
- M3 auth + feedback + admin gate — live
- Podcast detail + transcripts — live
- Cron is actually running — backlog draining at ~280/hr (should fully clear in ~9h)
- Commentary has depth, outside context, pushback

**Before session 6 ends:** rotate OpenAI / Anthropic / Gemini / Azure / JINA keys. Still in chat history from sessions 3-4.

**Pre-flight:**
```
cd ~/projects/portfolio/newsroom
vercel env pull .env.local --yes
bun install && bun test && bun run build
bun run db:ping
```

**Watch-outs:**
- **Commentary regression?** Check the `<before>/<after>` example in `workers/enrich/prompt.ts`. That's the load-bearing piece. Don't cut in refactors.
- **Cron seems broken?** Query `llm_usage` for last 15 min first; cron IS working now, the first instinct shouldn't be "it broke again".
- **Azure reasoning throttle** (high ≈ 6-7/min) still binds — see `feedback_azure_reasoning_throttle.md`.

---

## Session 4 shipped (2026-04-17 — 3 commits)

### Full article body via Jina Reader (`c090b4a`)

**Root cause fixed**: ~40% of curated items had summaries that literally said "已知信息仅来源于标题 / info only from title". RSS payloads usually only give `description` — 1-2 sentences. The LLM had nothing to work with.

**Fix**: `items.body_md` column + new worker `workers/fetcher/article-body.ts` using Jina Reader (`https://r.jina.ai/{URL}`). Cron order is now **normalize → article-body → enrich → score → commentary**. Tier-priority ordering (featured/p1/all first) ensures readers see the improvement on the 38 cards they actually browse before the 2000+ unseen rows.

- Jina paid tier: `JINA_API_KEY` 65-char `jina_…` Bearer, concurrency 30
- 402/429 → retry next tick (don't mark fetch done)
- 4xx/5xx terminal → mark done, fall back to RSS body
- YouTube URLs skipped (task #34 handles those via transcripts)
- `scripts/ops/run-cron.ts body` — local trigger for testing

### 晚点-tone prompt rewrite + per-axis HKR reasons (`c0d4eaa`)

**Root cause fixed**: Commentary, editor notes, and 精选理由 all read as AI-generated — abstract, banned phrases (然而/此外/值得注意的是/随着AI发展, revolutionize/paradigm shift), no concrete data hooks.

**Fix**: Rewrote `ENRICH_SYSTEM` / `scoreSystem` / `COMMENTARY_SYSTEM` in `workers/enrich/prompt.ts` using blog/CLAUDE.md's 晚点骨架+builder声音 guide + khazix-writer's L1 禁用词 scan:

| Rule | Applied |
|---|---|
| ZH banned phrases | 然而 · 此外 · 值得注意的是 · 综上所述 · 本质上 · 意味着什么 · 说白了 · 随着AI的快速发展 · 想象一下 · 细思极恐 · 赋能/助力/引领/打造 |
| EN banned phrases | revolutionize · unlock · empower · paradigm shift · it is worth noting · what this means is · in a rapidly evolving landscape · cutting-edge · seamlessly |
| Positives | 数据先行 · 冷叙述热判断 · 15-25 字短句 · 判断式小标题 · 具体名字 · 承认不确定 · 同侪口吻 |
| Commentary structure | 3-5 paragraph analysis · 判断式 ## headings (not "影响分析"/"背景") · lateral comparison to past 3 months if available · concrete 30-day signal-to-watch |
| Gap honesty | If body is thin, the prompt requires saying "正文未披露 X / the post does not disclose Y" — no hallucination |

**HKR per-axis reasons** — `hkr.reasonsZh` and `hkr.reasonsEn` added to `scoreSchema`. Each axis gets a 1-sentence rationale explaining WHY H/K/R passes or fails. UI chip tooltips now show `{axisLabel} — {reason}` instead of just the axis name.

Sample output (item #10 Qwen3.6-35B-A3B):

> **Editor note**: Qwen 把 Qwen3.6-35B-A3B 开源了，35B 总参仅 3B 激活，并把 Terminal-Bench 2.0 拉到 51.5。真正要盯的不是"开放"，而是这类 3B 激活 MoE 已经能正面打 27B-31B 稠密编码模型。
>
> **Analysis**: `## 3B 激活参数，已经打到一线开源编码带宽` / `## 提升最硬的一段，在代理式编码而不在通用知识` / `## 评测条件给得够细，但也埋了两处口径风险`
>
> — with specific benchmark deltas (51.5 vs 41.6, 73.4 vs 70.0, 49.5 vs 44.6) and explicit methodology caveats (200K context, 3hr timeout, 5-run average).

### Concurrency fan-out + commentary decoupled (`ec43419`)

**Root cause fixed**: The expanded prompt broke Azure's "No object generated" on every commentary call when using `reasoning_effort: high`. Also: commentary-in-enrich-loop bottlenecked the whole pipeline — each worker stalled 20-40s on commentary before starting the next item.

**Fix**:
- Split commentary out of `enrichOne`. It now runs in `workers/enrich/commentary.ts` using `profiles.enrich` (standard + low reasoning), which is 3-5x faster AND more reliable on long-form prompts.
- Fan out concurrency to match Azure paid tier headroom (10M TPM / 100K RPM):

| Worker | Before | After |
|---|---|---|
| enrich | 4 / 50 per run | **40 / 200** |
| commentary | 6 / 60 | **30 / 200** |
| score-backfill | 10 / 200 | **30 / 300** |
| article-body | 12 / 150 | **30 / 300** |
| db pool max | 10 | **40** |

Enrich + commentary now drain in parallel each cron tick instead of dripping 4 items at a time.

### Ops helpers
- `scripts/ops/reset-curated-for-backfill.ts` — scoped reset for the 38 non-excluded items (~$2)
- `scripts/ops/reset-for-body-and-tone.ts` — full reset (all 2308 items, ~$7)
- `scripts/ops/run-cron.ts body` — Jina body fetcher
- `scripts/ops/run-cron.ts yt` — YouTube transcript fetcher
- `scripts/ops/run-cron.ts enrich` — enrich pipeline (stages 1-3)

### YouTube transcripts (`5313301`)

Added `workers/fetcher/youtube-transcript.ts` — the YouTube-URL counterpart to the Jina article-body worker. Long-form AI interviews (Dwarkesh Patel, 硅谷101, Lex Fridman, BestPartners) have 1-3 hours of dense content that RSS gives us nothing about.

Uses `youtube-transcript` npm package (no key). Cycles through zh-Hans → zh-CN → zh → en → en-US → default — first match wins. On "disabled" → mark done. On network error → retry next tick. Long transcripts (>12K chars) get head+tail extraction (first 6K + last 5K).

Three new podcast/video sources added:
- **dwarkesh-yt** (en, priority 1) — UCXl4i9dYBrFOabk0xGmbkRA — Dario, Jeff Dean, Jensen, Michael Nielsen
- **thevalley101-yt** (zh, priority 1) — UChnNjLyx_5rk_iDPQ2BQDQA — 中文深度访谈
- **bestpartners-yt** (zh, priority 1) — UCGWYKICLOE8Wxy7q3eYXmPA — AI/Agent 中文深度视频

45 videos ingested, ~35 with transcripts (disabled rate by channel: Lex ~7%, BestPartners ~7%, TheValley101 ~60%, Dwarkesh ~50% — many Shorts disabled).

Cron: `article-body` + `youtube-transcript` run in parallel before `enrich` (different upstream rate-limits, no contention). `article-body` SQL-excludes YouTube URLs.

**Total source count: 65** (was 62, added 3).

### Podcasts UI page (`5c522af`)

New page at `/[locale]/podcasts` — shows everything from `source.group = 'podcast'` regardless of tier. Long-form interviews (1-3 hr) are rare enough (~101 items total across all channels) that aggressive curation would empty the page.

- `app/[locale]/podcasts/page.tsx` — reuses `StoryCard` + `TimelineEntry` from home feed; empty state with Headphones icon
- Sidebar `/podcasts` nav item between hotNews and lowFollower
- `lib/items/live.ts` extended with `sourceGroup` + `includeSourceGroup` options
- `lib/types.ts` — `Story.source.groupCode` optional
- i18n: `nav.podcasts` + `podcasts.{title,subtitle,empty,badges}` in both locales

**101 podcast items total** (15 × 6 channels = 90 + existing 11), **14 enriched so far** — rest drain via cron over ~5-7 hours.

---

## Session 4 commits summary

| SHA | What |
|---|---|
| `c090b4a` | Jina Reader body fetch + items.body_md |
| `c0d4eaa` | 晚点-tone prompts + per-axis HKR reasons |
| `ec43419` | Concurrency fan-out 4-10 → 30-40 + commentary decoupled |
| `ae2aa52` | HANDOFF doc session-4 recap |
| `5313301` | YouTube transcript worker + 3 channels |
| `c210583` | HANDOFF YT addition |
| `5c522af` | /podcasts page + sidebar nav + group filter |

Total: **7 commits, all deployed to prod main.**

---

## How to resume in Session 5 (M3 time)

```bash
cd ~/projects/portfolio/newsroom
vercel env pull .env.local --yes
bun install && bun test && bun run build
bun run db:ping

# verify live + podcasts
curl -s "https://news.ax0x.ai/zh/podcasts" | head -5

/big-task   # → M3: Supabase Auth + feedback + admin-email gate
```

**M3 plan (unchanged from s3 + s4 — see below in session-3 notes for schema)**. Key additions from session 4:
- `JINA_API_KEY` is in env (already paid + working); no action needed
- `ALLOWED_ADMIN_EMAILS` env var not yet set; default to `xingfanxia@gmail.com` in middleware
- When M3 lands, **rotate all keys** still in chat history (ANTHROPIC, GEMINI, AZURE, JINA)

---

## Session 3 shipped (2026-04-17 — 7 commits)

### Perf pack (f0e33b2 + 5cf904f)

16s TTFB on prod dropped to **84–200ms cached / 642ms cold**. Root causes:

| Issue | Fix |
|---|---|
| Functions in `iad1`, Supabase in `us-west-1` → ~70ms cross-country per DB roundtrip | `"regions": ["sfo1"]` in `vercel.json` |
| `force-dynamic` on LocaleLayout disabled ALL CDN caching (`x-vercel-cache: MISS` forever) | Removed from layout; `revalidate = 60` on home page; `generateStaticParams` prerenders `/zh` + `/en` at build |
| `hasLiveStories()` probe added an extra roundtrip | Dropped — fall back to mock only when DB returns nothing |
| 100+ `console.error` per SSR from next-intl missing-key logging | `onError: () => {}` + `getMessageFallback` in `i18n/request.ts` |
| `/admin/system` hung 60–120s → statement_timeout | `max:1` pool deadlocked on `Promise.all(6)` under PgBouncer; raised to `max:10` in `db/client.ts` |
| Admin totals showed `$0` with rows in the table below | `drizzle.execute()` returns array-like `[0]` not `{rows:[0]}`; added `asRows()` helper in `lib/llm/stats.ts` |

### UX fixes (a8e40da + c52deed + 4fc2da1)

- **Tab filter** — `/zh?tier=featured|all|p1` now actually re-SSRs with the chosen tier instead of just changing client state; each variant ISR-cached separately.
- **Timeline dot + rail** — dot was at `left-[80px]` overlapping timestamp's right edge. Moved to `left-[92px]` in a widened 24px gap lane, 7px clearance both sides.
- **Rail visibility** — `--color-rail` bumped from 6% white to 14% cyan.
- **Tier fallback bug** — P1 tab silently widened to `all` when empty; both tabs showed identical 39 items. Now only falls back on default `featured` tab when DB is cold.
- **Disabled search + filter UI** — dimmed with "Coming soon" until M3 wires real filtering.

### HKR + bilingual reasoning (3d34ed4 + 3c05c66 + 88421a6)

- **HKR rubric stored per-item**: new `items.hkr` jsonb column `{h, k, r: boolean}`. Three small pill chips render inline with the score — solid cyan = axis hit, dim outline = miss.
- **精选理由 shown** on every `featured`/`p1` card via existing `items.reasoning` (now `reasoning_zh` + `reasoning_en` — bilingual).
- **Commentary widened** from featured/p1 → all non-excluded. Now 38 curated stories all have editor note + analysis.
- **Backfill workers**:
  - `workers/enrich/score-backfill.ts` — rescores items missing `hkr` or `reasoning_{zh,en}`; 150 items in ~3 min at concurrency=10.
  - `workers/enrich/commentary.ts` — fills missing `commentary_at` for non-excluded items; concurrency=6.
  - Both wired into `/api/cron/enrich` so next tick handles stragglers automatically.
- **Trigger helper**: `scripts/ops/trigger-backfill.ts` — manual one-shot run if needed.

### Current data state (2026-04-17)

| Tier | Count | HKR | Commentary | Reasoning_zh | Reasoning_en |
|---|---|---|---|---|---|
| featured | 8 | ✓ | ✓ | 145/150 total | 145/150 total |
| p1 | 1 | ✓ | ✓ | | |
| all | 29 | ✓ | ✓ | | |
| excluded | 112 | ✓ | — | | |

HKR axis distribution across 150 scored items: **H=42 K=8 R=32 all-3=2**. K (knowledge) is the rarest — ~5% of items genuinely teach something new. Why p1 stays rare.

### Source catalog

**62 sources** — unchanged from session 2. Plus **2 pending additions blocked on transcript fetching**:
- `https://www.youtube.com/@TheValley101` (zh long-form AI interviews)
- `https://www.youtube.com/@DwarkeshPatel` (en long-form AI research interviews)

YouTube RSS only gives title + description; the transcript is the valuable part for 1-3hr content. Don't add these until task #34 (transcripts) is done — otherwise they become noise in the feed.

---

## What M3 should look like (use `/big-task`)

**Goal**: feedback persistence + editor auth → real metrics on the 策略迭代 page + admin routes gated to `xingfanxia@gmail.com`.

### Schema

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY,                     -- mirrors auth.users.id
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'editor',     -- editor | admin | reader
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE feedback (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id INT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  verdict TEXT NOT NULL,                   -- up | down | save
  note TEXT,
  policy_version TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, item_id, verdict)
);
```

### Auth

- `@supabase/ssr` for cookie-based sessions
- Supabase Auth magic-link login page at `/[locale]/login`
- **Middleware enforces admin-only access to `/admin/*`** (task #45):
  - Read Supabase session cookie
  - Check `user.email` against `ALLOWED_ADMIN_EMAILS` env var (default: `xingfanxia@gmail.com`)
  - Non-authorized → `NextResponse.redirect` to `/` (or render `/403`)
  - Hide `后台` / Admin nav section in sidebar for non-admin users
- Regular users can still use feedback controls (👍/👎/⭐) after magic-link login

### Endpoints

- `POST /api/feedback` — `{itemId, verdict, note?}`, upserts on `(user_id, item_id, verdict)`
- `DELETE /api/feedback/:id`
- `GET /api/admin/feedback?since=…` — gated to admin

### UI wiring

- `components/feed/feedback-controls.tsx` already has optimistic state → wire the POST
- `app/[locale]/admin/iterations/page.tsx` stops using mock; reads from `feedback` table + groups by `policy_version`
- `app/[locale]/login/page.tsx` — new magic-link form

## What M4 should look like (use `/mtc`)

**Goal**: Claude/Azure-pro agent loop that reads feedback + diffs `editorial.skill.md`.

- Use `profiles.agent` (Azure Pro + `xhigh` reasoning)
- Stream reasoning to the iteration console
- Editor (xingfanxia) approves the diff → commits as `v-next`
- Worker picks up new policy at next enrich pass (`loadPolicy()` is already SHA-versioned)

Blocked by M3 (no feedback data → no training signal).

---

## Task list (from TaskList)

### Pending
- **#36** M3 big-task (feedback + Supabase Auth + admin gate) ← **start here**
- **#37** M4 /mtc (editorial agent)
- **#45** Admin-route auth gate (xingfanxia@gmail.com) — blocked by #36
- **#41** Persist article as markdown (`items.body_md`)
- **#34** YouTube + podcast transcripts (seed: TheValley101, Dwarkesh)
- **#46** Podcast/Video dedicated UI section — blocked by #34
- **#47** Add TheValley101 + DwarkeshPatel sources — blocked by #34

### Completed in session 3 (today)
- **#44** Perf fix pack (region + ISR + cache)
- Plus ~5 reactive bug fixes not tracked as tasks (stats $0, pool deadlock, tier fallback, timeline overlap, HKR + bilingual reasoning, commentary widening)

### Recommended order
1. **`/big-task` #36 + #45** — unblocks feedback data for M4
2. **`/mtc` #37** — depends on #36 data
3. **#34 transcripts** — opens up the long-form video/podcast channel (highest-signal content type)
4. **#46 + #47** — consume #34's work
5. **#41** markdown persistence — quality-of-life for detail view

---

## How to resume next session

```bash
cd ~/projects/portfolio/newsroom
vercel env pull .env.local --yes
bun install && bun test && bun run build
bun run db:ping

# verify live data
curl -s "https://newsroom-orpin.vercel.app/api/feed/zh/rss.xml" | head -40

/big-task   # → M3 (feedback + Supabase Auth + admin-email gate)
```

## Environment (unchanged from session 2)

See `.env.example`. Key vars:
- `POSTGRES_URL` / `POSTGRES_URL_NON_POOLING` (Supabase, us-west-1)
- `AZURE_OPENAI_*` (standard + pro deployments)
- `ANTHROPIC_API_KEY`
- `GOOGLE_GENERATIVE_AI_API_KEY`
- `CRON_SECRET`
- `RSSHUB_BASE_URL` (optional mirror)

New for M3:
- `NEXT_PUBLIC_SUPABASE_URL` (already present)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (already present)
- `ALLOWED_ADMIN_EMAILS` — default `xingfanxia@gmail.com`

## Gotchas / known state

- **Azure Pro** (xhigh reasoning) timed out on the newsletter prompt; commentary + newsletter currently run on `profiles.score` (standard + high). Upgrade once Azure quota is stable.
- **Legacy rsshub.app sources** (~12) still fail; self-host RSSHub on Vercel + set `RSSHUB_BASE_URL` to revive. Working alternatives already in catalog.
- **5 items failed rescore** with "No object generated" — next enrich cron retries them; no data loss.
- **Keys still in chat history** from session 2 — rotate once M3 is verified.
- **`scripts/ops/trigger-backfill.ts`** was committed — safe to keep as a manual trigger or delete if unused.

## Key file index (session-3 additions)

- `workers/enrich/score-backfill.ts` — score-only backfill
- `workers/enrich/commentary.ts` — commentary backfill (now all non-excluded)
- `workers/enrich/prompt.ts` — scoreSchema has `hkr`, `reasoningZh`, `reasoningEn`
- `db/schema.ts` — `items.hkr`, `items.reasoning_zh`, `items.reasoning_en` added
- `components/feed/timeline-rail.tsx` — rail + dot at x=92 in widened gap
- `components/feed/story-card.tsx` — HKRBadges component + 精选理由 block
- `lib/llm/stats.ts` — `asRows()` helper fixing aggregate parsing
- `app/[locale]/_hot-news-tabs.tsx` — client tabs via URL searchParams
- `i18n/request.ts` — silent `onError` + `getMessageFallback`
- `vercel.json` — `"regions": ["sfo1"]`
