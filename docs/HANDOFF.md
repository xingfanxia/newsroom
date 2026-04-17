# AX's AI RADAR — Session Handoff (2026-04-17, Session 3)

> Read this first before resuming. M0–M2 from session 1, feature expansion + rebrand from session 2, perf + UX fixes from session 3. **M3 + M4 still pending.**

---

## TL;DR

- **Live**: https://newsroom-orpin.vercel.app (also `news.ax0x.ai`)
- **Repo**: https://github.com/xingfanxia/newsroom
- **Brand**: AX's AI RADAR / AX 的 AI 雷达 (cyan on dark observatory)
- **Done**: M0 shell · M1 ingest · M2 enrich/cluster · session-2 (RSS/commentary/newsletter/i18n/cost) · session-3 (perf/HKR/bilingual reasoning)
- **Pending**: **M3 auth + feedback** (`/big-task`) · **M4 editorial agent** (`/mtc`) · video/podcast transcripts · article markdown

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
