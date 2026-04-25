# 每日 AI 日报 — Design

**Status**: Approved 2026-04-25, ready for implementation planning.
**Scope**: Add a daily 9pm-Pacific opinionated AI column written in 卡兹克 (khazix) voice; expose newsletter + 3 lanes via RSS; add MCP resources for the column; new operator skill that composes existing `ax-radar` + `khazix-writer` skills.

---

## 1. Motivation

The newsroom currently produces a structured daily digest (`headline / overview / highlights / commentary`) at ~5pm Beijing via `runNewsletterBatch("daily")`. The format is generic-editorial: legible but not memorable, hits no voice, no take. RSS doesn't exist anywhere in the product.

We want a daily column that:
1. Reads like a real person sharing a curious take, not a corporate roundup (khazix voice — 口语化, 私人视角, 文化升维, 句式断裂).
2. Has a brief skim layer on top (numbered top-of-day summary) and a deep narrative below (long-form reactions on 2-3 most interesting items).
3. Pulls from the operator's actual editorial selection (热点聚合 + 严选), not all-importance signal — papers excluded.
4. Is consumable as RSS for human subscribers and as MCP resource for agents.

---

## 2. Scope

### In

- New daily-column writer (replaces existing `runNewsletterBatch("daily")` daily branch)
- New skill `~/.claude/skills/ax-radar-daily-column/` composing `ax-radar` (data) + `khazix-writer` (voice)
- Schema additions to `newsletters` table for column-format fields
- `/zh/daily` tab + landing-shows-latest + `/zh/daily/[date]` archive page
- RSS endpoints: daily-column + 热点聚合 + 严选 + 论文 (4 feeds), public, IP rate-limited
- MCP resources: `ax-radar://daily/latest`, `ax-radar://daily/{date}`
- Cron schedule change: `0 5 * * *` UTC (9pm PST / 10pm PDT)

### Out

- English-locale column (zh-only; revisit after voice is validated)
- Monthly newsletter format change (untouched, stays structured-digest)
- Per-source RSS feeds (~150 URLs is operational debt with no consumer)
- Email/push delivery (pull-only via RSS or MCP)
- `/en/daily` shows "coming soon" empty state (route exists for future, no content this scope)

---

## 3. Architecture

### 3.1 Data flow

```
Cron (0 5 * * * UTC)
    │
    ▼
runDailyColumn(now)                                 ◄── new function, replaces daily branch
    │
    ├─ Selection: 严选 (today, curated_only, papers excluded)
    │              ∪ top 15 of 热点聚合 (today, papers excluded, importance DESC)
    │              capped at 20 unique items, rolling 24h window
    │
    ├─ generateStructured() with khazix-voice prompt
    │   ├─ system prompt loaded from lib/llm/prompts/daily-column.md
    │   └─ schema: { title, summary_md, narrative_md, featured_item_ids, theme_tag }
    │
    └─ Upsert into newsletters table
        on conflict (kind=daily, locale=zh, period_start) update column_* fields
```

### 3.2 Selection logic

Function `selectDailyColumnPool(now: Date)` in `workers/newsletter/select.ts` (new file):

1. Compute window: `[now - 24h, now)` snapped to the hour for idempotency.
2. Query 严选: items where source `curated = true`, published in window, `papers` tag absent, ordered by `importance DESC`. Take all (typically 5-10).
3. Query 热点聚合: items where source-tags exclude `arxiv|paper`, published in window, ordered by `importance DESC`, limit 15.
4. Merge by `id`, prefer the 严选 metadata when an item appears in both. Cap at 20.
5. If `result.length < 5`, return `{ rows: [], skipReason: "insufficient-signal" }` — cron writes nothing, no fallback to old format.

Edge case: if 严选 alone exceeds 20 (rare), trim to 20 by importance and skip the 热点 fill.

### 3.3 Schema additions

Extend `newsletters` table (additive, all nullable):

```
column_title                text          -- khazix-style headline
column_summary_md           text          -- numbered list of top 5 stories with quick takes
column_narrative_md         text          -- long-form khazix narrative, 2000-4000 字
column_featured_item_ids    integer[]     -- the 2-3 stories given deep treatment in narrative
column_theme_tag            text          -- one-line theme of the day (for tagging/RSS category)
```

Existing fields (`headline`, `overview`, `highlights`, `commentary`) stay populated for legacy daily rows; new daily rows write `column_*` only and leave the legacy fields NULL. Monthly rows continue using the legacy fields. Renderer logic discriminates on `column_title IS NOT NULL`.

No migration of existing rows. They remain readable via legacy template.

New table for QC observability:

```
column_qc_log
  id              serial primary key
  newsletter_id   integer references newsletters(id)
  generated_at    timestamptz not null default now()
  l1_pass         boolean not null
  l2_pass         boolean not null
  l3_pass         boolean not null
  l4_pass         boolean not null   -- l4 is heuristic; pass = nothing flagged
  hits            jsonb              -- array of { layer: "l1"|"l2"|...|, rule: string, snippet: string }
```

Non-blocking: bad columns still ship; the table gives the operator a queryable record of which voice-rule violations are recurring.

### 3.4 Voice + structure spec

Single source of truth: `lib/llm/prompts/daily-column.md` in the repo. Server-side prompt loads it at module init via `fs.readFileSync` (Node.js runtime, deploy artifact includes the file). Skill at `~/.claude/skills/ax-radar-daily-column/SKILL.md` mirrors the same content under a `do not edit — mirrored from newsroom/lib/llm/prompts/daily-column.md` comment header.

Spec contents (high-level — full prompt drafted at implementation time):

- **Voice**: full khazix-writer voice rules (banned phrases, banned punctuation, recommended 口语化 phrases, 句式断裂, 文化升维, 私人视角, 谦逊铺垫, 反向论证). Skill links back to `khazix-writer` for full reference.
- **Structure A** (locked from brainstorming):
  - `column_title`: 卡兹克式标题 — concrete, curiosity-driven, ≤20 字, no marketing-verb opener.
  - `column_summary_md`: numbered 1-5, each entry = `[story title — 50-100 字 quick take with 1 personal reaction] [#item-id]`. The one allowed exception to khazix's no-list rule.
  - `column_narrative_md`: 2000-4000 字 through-flow, no markdown subheadings, picks 2-3 most interesting from the numbered list, deep personal take with cultural 升维, references back as 第1件 / 第3件 (callback structure / 契诃夫之枪).
  - `column_theme_tag`: one phrase (≤8 字) summarizing the day's dominant theme.
  - Total: ~2500-4500 字, ~5-7 minute read.
- **L1-L4 self-check adapted to daily-column form** — voice gates from khazix-writer, with the column-specific exception that 数字编号 in the summary is allowed.

### 3.5 Writer composition

Cron worker (`workers/newsletter/run-daily-column.ts`):

```
runDailyColumn(now)
  → selectDailyColumnPool(now)
  → if pool too small, skip with reason, return report
  → generateStructured({
      ...profiles.score,
      task: "daily-column",
      system: DAILY_COLUMN_SYSTEM_PROMPT (loaded from daily-column.md),
      messages: [{ role: "user", content: renderItemsForPrompt(pool) }],
      schema: dailyColumnSchema,
      maxTokens: 12000  // narrative can run ~3000 字 ≈ ~5000 tokens; keep headroom
    })
  → upsert into newsletters
  → return report
```

Cron route at `app/api/cron/newsletter-daily/route.ts` switches from `runNewsletterBatch("daily")` to `runDailyColumn()`. Monthly route untouched.

### 3.6 Skill composition

`~/.claude/skills/ax-radar-daily-column/SKILL.md` does NOT redo data fetching or voice. It:

1. Points to `ax-radar` for fetching (`ax_radar_feed view=today` + `curated_only=true`, dedupe, 24h window).
2. Points to `khazix-writer` for voice baseline.
3. Adds column-specific structure spec (Structure A details, length budgets, the 数字编号 exception).
4. Adds output schema for operator handoff (`{title, summary_md, narrative_md, featured_item_ids, theme_tag}`).
5. Defines operator commands:
   - "write today's column" → fetch via ax-radar, draft, run L1-L4, present.
   - "regen column for [date]" → call `POST /api/admin/regen-daily-column` with date param (server-side, requires admin auth).
   - "review this draft" → run L1-L4 self-check on operator-supplied text.

### 3.7 Page surfaces

Three new pages under `app/[locale]/daily/`:

- `/[locale]/daily/page.tsx` — landing, shows latest column for that locale (zh shows latest, en shows empty state with "coming soon").
- `/[locale]/daily/[date]/page.tsx` — archive entry by `YYYY-MM-DD`.
- `/[locale]/daily/archive/page.tsx` — list of past columns by date, paginated.

Renderer reads `column_*` fields from `newsletters`. Markdown rendered with existing markdown component (used elsewhere in the app). 4th nav entry added in `lib/shell/nav-data.ts` — 每日.

### 3.8 RSS endpoints

Four feeds at `app/api/rss/[slug]/route.ts` (one dynamic route, slug ∈ {`daily`, `today`, `curated`, `papers`}):

- `daily.xml` — one `<item>` per recent daily column, last 50 days. Title = `column_title`, description = `column_summary_md` rendered as HTML, content:encoded = `column_summary_md + column_narrative_md` rendered as HTML, link = `https://news.ax0x.ai/zh/daily/[date]`, pubDate = `period_start`, guid = the link URL (date-keyed).
- `today.xml` — last 50 items from 热点聚合 (today view, papers excluded). One `<item>` per item, title = `title_zh ?? title_en ?? title`, description = `summary_zh ?? summary_en ?? ""`, link = `https://news.ax0x.ai/zh/items/[id]`, pubDate = `published_at`, guid = item canonical URL.
- `curated.xml` — last 50 items from 严选 (curated_only). Same field shape as today.xml.
- `papers.xml` — last 50 items from 论文 (`include_source_tags=arxiv,paper`). Same field shape.

All four feeds are zh-default for v1 (matches the column's zh-only scope). Locale parameterization (`?locale=en`) deferred — add when there's a clear EN consumer.

All four return `Content-Type: application/rss+xml; charset=utf-8`. Cache headers: `Cache-Control: public, max-age=900` (15 min).

Rate limit middleware (60 req/hour per IP) via in-memory token bucket; 429 above. Lives in `lib/rate-limit/rss.ts`. Acceptable to be Vercel-instance-local — RSS pollers don't span instances meaningfully.

### 3.9 MCP resources

Two new resources in `app/api/mcp/route.ts`:

- `ax-radar://daily/latest` — returns latest zh column as markdown (`# title \n\n summary_md \n\n narrative_md`).
- `ax-radar://daily/{date}` — by `YYYY-MM-DD`. Returns 404-equivalent empty-resource if no column for that date.

Existing `ax-radar://today | curated | papers` resources unchanged.

### 3.10 Cron schedule

`vercel.json` updates:

```
"crons": [
  ...
  { "path": "/api/cron/newsletter-daily", "schedule": "0 5 * * *" },   // was "11 9 * * *"
  { "path": "/api/cron/newsletter-monthly", "schedule": "37 9 1 * *" } // unchanged
]
```

DST drift: 9pm PST (winter) / 10pm PDT (summer). Acceptable — no operational toil, no per-season schedule flip.

---

## 4. Testing

- **Unit**: selection logic (`selectDailyColumnPool`) — window math, dedupe, cap, papers exclusion, insufficient-signal skip. Mock the DB.
- **Integration**: end-to-end column generation against staging — run `runDailyColumn()` against a fixed historical date, snapshot the schema-validated output, eyeball the markdown.
- **L1-L4 self-check**: implemented as a pure function `runColumnSelfCheck(draft)` returning `{l1: pass/fail, l2: …, l3: …, l4: …, hits: string[]}`. Server-side cron runs this and logs failures to a new `column_qc_log` table (non-blocking — bad column still ships, but operator gets visibility).
- **RSS**: snapshot tests for each feed against fixture data, validate against W3C feed validator schema.
- **Page rendering**: existing component-level tests; smoke test the daily page renders with seeded data.

No E2E Playwright tests in scope (carryover deferred per existing handoff).

---

## 5. Migration / rollout

1. Schema migration first (`drizzle-kit push`, then `bun run db:hnsw` per existing operator runbook).
2. Implement `selectDailyColumnPool` + `runDailyColumn` + voice spec at `lib/llm/prompts/daily-column.md`. Iterate prompt against historical fixtures until output passes L1-L4 by manual eyeball.
3. Wire skill, including the prompt mirror.
4. Wire pages (`/zh/daily/*`).
5. Wire RSS (4 feeds + rate limit).
6. Wire MCP resources.
7. Update cron schedule + cutover: switch `newsletter-daily` route to `runDailyColumn()`.
8. Smoke check after first cron tick — manual review of column output, fix prompt if needed (re-run via skill regen command).

Rollback: revert the cron route change to call `runNewsletterBatch("daily")` again; the legacy code path stays intact through this feature work.

---

## 6. Open follow-ups (deferred, not blocking)

- English column (locale=en) — once zh voice is validated.
- Email delivery — could be added later via separate cron + a transactional email integration.
- Push notifications — same.
- Khazix-style voice for the monthly newsletter — different reader (archival vs. daily companion); revisit only if there's demand.
- L4 (活人感) self-check is hard to automate — currently manual eyeball. Could explore an LLM-judge variant where a separate prompt scores draft on 温度感 / 独特性 / 姿态 / 心流, but that's its own subproject.
- Per-source RSS feeds — only if a real consumer asks.
- Subscription/auth model for RSS — current public + rate-limit may evolve if abuse becomes real.

---

## 7. Decisions log

| # | Decision | Why |
|---|----------|-----|
| 1 | Approach C → absorb existing structured digest | Single source of truth; the new exec_summary IS the structured layer |
| 2 | Selection B (严选 + top 15 热点) capped at 20, 24h rolling | Curated sets editorial spine, 热点 fills coverage; matches existing window math |
| 3 | zh-only column for v1 | khazix voice is structurally Chinese; defer EN until voice is validated |
| 4 | Structure A (numbered exec + through-narrative) | Skim+deep audiences in one artifact; numbered list is one allowed exception to khazix no-list rule |
| 5 | Tab `/zh/daily` with latest on landing | Marquee editorial product deserves its own destination; homepage hero deferred |
| 6 | RSS scope B (daily + 3 lanes), public + rate-limit | RSS exists to be subscribed to; rate limit prevents pathological scraping |
| 7 | Skill composes existing ax-radar + khazix-writer | Don't reinvent fetching/voice; new skill adds column-specific structure spec |
| 8 | Sync model Y (mirror with do-not-edit header) | Operator-clarity wins; manual sync acceptable at quarterly cadence |
| 9 | Cron `0 5 * * *` UTC | 9pm PST / 10pm PDT; accept DST drift over operational toil |
| 10 | Existing daily replaced; monthly untouched | Daily is the focus; monthly is an archive format with a different reader |
