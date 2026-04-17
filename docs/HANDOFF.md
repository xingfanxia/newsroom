# AX's AI RADAR — Session Handoff (2026-04-17, Session 4 complete)

> Read this first before resuming. Session 1 = M0–M2 shell/ingest/enrich. Session 2 = RSS + commentary + newsletter + i18n + cost. Session 3 = perf + HKR + bilingual reasoning. **Session 4 (today) = Jina body fetch + 晚点-tone prompts + per-axis HKR + concurrency fan-out + YouTube transcripts + /podcasts UI.** M3 + M4 pending.

---

## TL;DR

- **Live**: https://newsroom-orpin.vercel.app (also `news.ax0x.ai`) · **new**: `/podcasts` page
- **Repo**: https://github.com/xingfanxia/newsroom
- **Brand**: AX's AI RADAR / AX 的 AI 雷达 (cyan on dark observatory)
- **Done through s4**: M0 shell · M1 ingest · M2 enrich/cluster · RSS/commentary/newsletter/i18n/cost · perf/HKR/bilingual reasoning · **full article bodies via Jina · YouTube transcripts · 晚点-tone editorial voice · per-axis HKR tooltips · 10-20x concurrency · /podcasts page · 65 sources**
- **Pending**: **M3 auth + feedback** (`/big-task`) · **M4 editorial agent** (`/mtc`) · auth-gated admin (#45)
- **Data state end of s4**: 199/2822 items enriched · 39 curated (featured 16 + p1 13 + all 10) · 160 excluded · 101 podcast items queued (14 enriched, rest draining via cron over next ~7h)

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
