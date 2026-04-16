# AX's AI RADAR — Session Handoff (2026-04-16, Session 2)

> Read this first before resuming. Covers M0-M2 from session 1 + the large feature expansion + rebrand shipped in session 2.

---

## TL;DR (updated)

- **Live**: https://newsroom-orpin.vercel.app — auto-deploys from `main`
- **Repo**: https://github.com/xingfanxia/newsroom
- **Brand**: renamed AI·HOT → **AX's AI RADAR** / **AX 的 AI 雷达** (session 2)
- **Milestones done**: M0 shell · M1 ingestion · M2 enrich/cluster · + session-2 extensions
- **Milestones pending**: **M3 auth/feedback** (use `/big-task`) · **M4 editorial agent** (use `/mtc`)

## Session 2 shipped (13 commits on main)

All 8 of the user's session-2 asks landed + 3 new features:

| # | Ask | Status | Commit |
|---|-----|--------|--------|
| 1 | Timeline dot alignment | ✅ | 8066a15 |
| 2 | Locale toggle content parity | ✅ bilingual titles + canonical tags | 60535bf |
| 3 | Token + cost tracking (cached + input + output + LiteLLM pricing) | ✅ incl. cached-input extraction | 7af9231 |
| 4 | YT/podcast transcripts | ⏸ deferred to next session | — |
| 5 | Source health (19 ok → 22 ok + 20 new working sources) | ✅ | 438b05b |
| 6 | Rebrand to "AX's AI RADAR" + aesthetic polish | ✅ radar sweep motion grammar | 8066a15 |
| 7 | Expand source catalog from ref lists | ✅ | 438b05b |
| 8 | yage.ai (鸭哥) P0 | ✅ | 438b05b |
| 9 | Public RSS export | ✅ `/api/feed/{locale}/rss.xml` | 3305a45 |
| 10 | Full article markdown | ⏸ deferred to next session | — |
| 11 | AI editor commentary per item | ✅ short note + long analysis | fab73a3 |
| 12 | Daily + monthly newsletter + RSS | ✅ | _latest_ |

### Key files added/changed in session 2

**Rebrand + motion:**
- `components/layout/logo.tsx` — "AX" + radar-sweep glyph + "RADAR" with conic-gradient sweep
- `public/favicon.svg` — radar grid + sweep wedge + pulsing blip
- `app/globals.css` — `.radar-sweep` + `.radar-blip` keyframes + `prefers-reduced-motion` opt-out
- `messages/{zh,en}.json` — brand renamed, tags dict added

**Schema additions (drizzle):**
- `items`: `title_zh`, `title_en`, `editor_note_zh`, `editor_note_en`,
  `editor_analysis_zh`, `editor_analysis_en`, `commentary_at`
- `llm_usage` (new): per-call token + cost ledger with cached/reasoning split
- `newsletters` (new): daily + monthly digests (kind, locale, period_start uniq)

**New workers:**
- `workers/newsletter/index.ts` — `runNewsletterBatch('daily' | 'monthly')`
- `workers/enrich/index.ts` — added stage 4 commentary (non-fatal for featured/p1)

**LLM observability:**
- `lib/llm/pricing.ts` — LiteLLM JSON fetcher + cost computation (+ hardcoded fallback)
- `lib/llm/usage.ts` — fire-and-forget `recordUsage` + cached/reasoning extractors
- `lib/llm/stats.ts` — aggregation queries for the admin dashboard
- `app/[locale]/admin/system/page.tsx` — spend cards + task/model breakdown + recent calls

**RSS surface:**
- `/api/feed/{locale}/rss.xml` — items with `<content:encoded>` (note + summary + analysis)
- `/api/feed/newsletter/{locale}/rss.xml` — daily + monthly digest feed

**Cron schedule (now 8 jobs):**
- Added: `newsletter-daily` at 09:11 UTC daily, `newsletter-monthly` at 09:37 UTC on 1st

**Source catalog — 61 sources (was 41):**
- P0: `yage-computing-life` (鸭哥's Computing Life)
- Wechat2RSS bridges for 机器之心 / 新智元 / 量子位 / 腾讯技术工程 / 阿里技术
- Direct-feed alternatives: `36kr-direct`, `sspai-direct`, `huxiu-feedx`
- Macro/geopolitics: `sinocism`, `bloomberg-tech`, `ft-technology`, `rest-of-world`, `thepaper-feedx`, `nytimes-cn-feedx`, `jiemoren-macro-w2r`
- Research: `arxiv-cs-lg`, `hf-papers-takara`
- Personal blogs: `ruanyifeng-blog`, `coolshell-cn`

**RSSHUB_BASE_URL** env — new; when set, rewrites `rsshub.app` → mirror at fetch time. The legacy `rsshub.app`-based catalog entries still fail (free instance 403s) but have working alternatives above. User can deploy self-hosted RSSHub on Vercel to revive them.

---

## LLM cost profile (observed on 50-item batch + one newsletter)

| Task | Calls | Cost | Per-item |
|---|---|---|---|
| enrich (stage 1) | 50 | $0.23 | $0.0045 |
| embed (stage 2) | 50 | $0.0006 | $0.00001 |
| score (stage 3) | 50 | $0.40 | $0.008 |
| commentary (stage 4, featured/p1 only) | 2 | $0.05 | $0.024 |
| newsletter (daily) | 2 | $0.07 | — |

Estimated per 1000 fully-processed items: **~$12.60** ($6K/y on Azure free credits at steady state = effectively free).

---

## What M3 should look like (use `/big-task`)

Goal: feedback persistence + editor auth → real metrics on the 策略迭代 page.

Schema additions:
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

Auth: `@supabase/ssr` + Supabase Auth magic-link. Middleware-gated admin routes.
Endpoints: `POST /api/feedback`, `DELETE /api/feedback/:id`, `GET /api/admin/feedback?since=…`.
UI wiring: `components/feed/feedback-controls.tsx` already has optimistic state — just wire the POST. `app/[locale]/admin/iterations/page.tsx` stops using mock data.

## What M4 should look like (use `/mtc`)

Goal: Claude/Azure-pro agent loop that reads feedback + diffs `editorial.skill.md`.

- Use `profiles.agent` (azure-openai-pro + xhigh)
- Stream reasoning to the iteration console
- Editor approves the diff → ships as v-next
- Worker picks up new policy at next enrich pass (`loadPolicy()` already hash-versioned)

---

## Known followups (defer to next session or later)

- **Article markdown persistence** (task #41) — add `items.body_md`; upgrade normalizer to produce markdown (turndown); include in detail view + RSS
- **YT/podcast transcripts** (task #34) — `youtube-transcript` lib for YT channel feeds; Podcast 2.0 `<podcast:transcript>` tag parsing; feed transcript into `body` before enrich
- **Detail view per story** — doesn't exist yet; editor analysis + full body would live there
- **Commentary via pro profile** — currently uses `profiles.score` (standard+high); can upgrade to `profiles.agent` if quality demands, cost ~$0.12/item
- **Policy versioning** — currently just first-8-chars sha256; M4 should introduce `policy_versions` table with lineage
- **Legacy RSSHub sources** — 12 still failing; self-host RSSHub on Vercel + set `RSSHUB_BASE_URL` to unblock

## How to resume next session

```bash
cd /Users/xingfanxia/projects/portfolio/newsroom

# verify
vercel env pull .env.local --yes
bun install && bun test && bun run build
bun run db:ping
bun scripts/ops/run-cron.ts daily    # confirm 22+ sources ok

# then
/big-task  # → M3 feedback + auth
/mtc       # → M4 editorial agent
```

## Environment (unchanged from session 1)

See `.env.example` for the full template. Newly added:
- `RSSHUB_BASE_URL` — optional mirror for rsshub.app (blank = keep rsshub.app)

Live env synced to `.env.local` + all 3 Vercel envs. Keys in git history should be rotated when M3 verified.
