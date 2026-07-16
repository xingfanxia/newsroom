# Newsletter Email Feature — Implementation Plan (NLE)

> Status: **NLE-1…7 SHIPPED 2026-07-16** (feat/newsletter-email). Migration
> applied, real-send smoke passed (user-directed), Vercel env wired; plus an
> /admin/newsletter tracking tab and ax-fleet subscriber tracking (user-added
> scope). Only DMARC TXT (report-only, optional) remains — see §8 step 5.
> Naming: phases are `NLE-1 … NLE-7`.
>
> What this adds: email delivery for the EXISTING newsletter content pipeline.
> `workers/newsletter/` already generates a zh daily column (每日日报) into the
> `newsletters` table at 05:00 UTC and a monthly digest; nothing in the repo
> sends email today. This feature adds: subscribers, subscribe/confirm/
> unsubscribe flow + UI, Resend delivery adapter, two daily email kinds
> (每日日报 digest + 每日精选 featured picks), and a send cron.

---

## 0. Fixed facts (verified 2026-07-16 — do not re-derive)

| Fact | Value |
|---|---|
| Resend account | zhupifeizao@gmail.com (dedicated account, NOT xiaxbackup@) |
| Verified sending domain | `news.ax0x.ai` — verified, region ap-northeast-1, sending enabled, receiving disabled |
| API key | already in `.env.local` as `RESEND_API_KEY` (gitignored). Must also go to Vercel envs during NLE-7. NEVER commit. |
| Resend batch API | ≤100 emails/call, counts as 1 rate-limit request; supports `Idempotency-Key` header (24h expiry); no attachments/scheduled_at in batch |
| Site | https://news.ax0x.ai (Next.js 16 App Router, sfo1, bun) |
| Daily column generation | cron `newsletter-daily` at `0 5 * * *` UTC (13:00 北京), `runDailyColumn()` → `newsletters` row, kind='daily', locale='zh' ONLY, `maxDuration=800` |
| Daily column content | `columnTitle` (≤24字), `columnThemeTag` (≤10字), `columnSummaryMd` (100-200字 md), `columnNarrativeMd` (2500-4500字 md, 5-8 `##` sections, `**bold**`, `>` quotes, `[#NNNN]` item refs), `columnFeaturedItemIds` (1-3), `itemIds`, `storyCount` |
| Featured items (精选 source) | `items.tier IN ('featured','p1')`; only these carry `editor_note_*` + `editor_analysis_*` (锐评, ~200字, bilingual). Story outbound link = original external `items.url` (no per-item site page) |
| Issue permalink | `/zh/daily/<YYYY-MM-DD>` (`dailyColumnIssueRoute` in `lib/daily-column/routes.ts`) |
| `[#NNNN]` gotcha | site renderer linkifies to `/zh/items/<id>` — that page route DOES NOT exist. Emails must NOT copy that behavior (see §5 templates) |
| Runtime design tokens | `app/globals.css` (authoritative): bg `#0a0a0a`, card `#0d1117`, text `#f0f6fc`, green `#3fb950`, blue `#58a6ff`. DESIGN.md's cyan `#3ee6e6` is aspirational drift — do NOT use it |
| DB | Turso libSQL `newsroom-v2`. **`db:push` HARD-DISABLED** (drops items.embedding, unrecoverable, NO BACKUP). New tables go through the checksummed raw-SQL runner pattern (`lib/public-content/publisher/outbox-migration.ts`) + `schema_migrations` + guarded `--apply` ops script |
| Cron auth | `verifyCron` (Bearer `CRON_SECRET`) via `runCronJsonRoute` (`app/api/cron/_route.ts`); route exports `maxDuration=800`, `dynamic="force-dynamic"`, `runtime="nodejs"` |
| Cron registry lockstep | `vercel.json` crons + `app/api/cron/<slug>/route.ts` + `scripts/ops/run-cron.ts` CRON_RUNNERS + `lib/shell/system-stats.ts` activity signal — all four in the same change |
| Env access pattern | direct `process.env.*`, loud throw at call site (model: `lib/llm/index.ts`). No central env module |
| Hermetic gates | `bun run verify` = typecheck + lint (0 warnings) + build + 3×knip + hermetic tests. Separate: `bun run verify:public-boundary`. Tests: DI + `mock.module` spread-mock rules per `docs/testing/strategy.md`; file-backed libSQL; `createHermeticRuntimeOverrides()` injects fake creds |
| Rate limiting | `lib/rate-limit/public.ts` `publicRateLimit` + per-endpoint families in `lib/api/public-endpoint-config.ts` |
| POST body validation | `parseJsonRequestBody(req, zodSchema, {envelope})` (`lib/api/json-body.ts`) |
| Form pattern | `components/auth/login-form.tsx` — 'use client', idle/sending/error state machine, `useTranslations`, `Button`/`Input` primitives |
| i18n | `messages/en.json` + `messages/zh.json` mirrored namespaces; nav labels are inline-bilingual in `lib/shell/nav-data.ts` (NOT messages) |
| No footer exists | navigation is left-rail only (`lib/shell/nav-data.ts` → `components/shell/left-rail.tsx`) |
| md→HTML | does NOT exist in repo (RSS escapes raw markdown). Email needs its own constrained renderer (§5) |

## 1. Decisions (volatile-first; each logged as autonomous unless marked)

1. **Own Turso tables are the source of truth; Resend is a dumb delivery adapter.**
   No Resend Audiences/Broadcasts — they'd split subscriber state across two
   systems and still require our own double-opt-in. Transactional batch sends
   with our own `List-Unsubscribe` headers.
2. **Two email kinds, two subscription toggles**: `daily_digest` (每日日报 = the
   daily column) and `daily_featured` (每日精选 = the window's featured/p1 items
   with 锐评). Subscribe form defaults: 日报 ✅, 精选 ✅ (both checked — user opted
   into a newsletter signup form deliberately; unchecking is one click).
3. **Double opt-in** (confirm email with token link). Protects the fresh sending
   domain's reputation from spam-trap/malicious signups.
4. **zh-only sends in v1.** The daily column only exists in zh
   (`DAILY_COLUMN_LOCALE='zh'`). `locale` is stored per subscriber for future en
   support (items ARE bilingual; an en featured email is possible later).
5. **Raw `fetch` Resend adapter, no `resend` npm dep.** The API surface used is
   3 endpoints (`POST /emails`, `POST /emails/batch`); a typed adapter keeps
   the dependency tree flat and the test seam obvious (inject fetch).
6. **Hand-rolled constrained md→HTML renderer** for email bodies. The narrative
   format is contract-bound by `lib/llm/prompts/daily-column.md` (## sections,
   bold, blockquotes, lists, `[#NNNN]`); a ~120-line escaped-first renderer with
   characterization tests beats adding + inlining a general md lib. If execution
   hits real gaps, fall back to `marked` (pin current version via `npm view`).
7. **Send cron at `40 5 * * *` UTC** (13:40 北京) — 40 min after generation
   starts (generation caps at 800s). One cron sends both kinds.
8. **Idempotency = DB ledger (primary) + Resend Idempotency-Key (secondary).**
   Ledger unique `(email_kind, period_key, subscriber_id)`; period_key =
   `YYYY-MM-DD` of the column window end. Batch idempotency key =
   `newsroom/<kind>/<period_key>/<sha256(sorted chunk emails)[:16]>`.
9. **From addresses**: `AX 的 AI 雷达 <daily@news.ax0x.ai>` (日报),
   `AX 的 AI 雷达 <featured@news.ax0x.ai>` (精选),
   `AX 的 AI 雷达 <hello@news.ax0x.ai>` (confirm). Domain receiving is disabled →
   no reply handling; optional `NEWSLETTER_REPLY_TO` env (default unset).
10. **Tokens**: `confirm_token` + `unsubscribe_token`, independent 32-byte
    `crypto.randomBytes` base64url, stored plaintext (DB is private; leak blast
    radius = someone can unsubscribe/confirm — acceptable), unique-indexed.
11. **Subscribers are PRIVATE data** — no public_content outbox triggers, never
    exported to the R2 public snapshot, excluded from `/api/public/*`.
    `verify:public-boundary` must stay green.
12. **Email visual identity = runtime terminal palette** (§0), dark-native,
    table-layout, inline styles, 600px. Executor MUST invoke the
    `frontend-design` skill before writing templates (CLAUDE.md forcing rule).

## 2. Schema (NLE-1) — migration `20260716_newsletter_email_v1`

Follow `lib/public-content/publisher/outbox-migration.ts` shape exactly
(idempotent DDL array + sha256 checksum + transactional `schema_migrations`
registration). New module `lib/email/migration.ts`; guarded operator script
`scripts/ops/migrate-newsletter-email.ts` (refuses without `--apply`).
Mirror both tables in `db/schema.ts` (drizzle, `casing: 'snake_case'`,
`nowMs` default constant at line ~39).

```sql
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL COLLATE NOCASE,          -- lowercased at the boundary too
  locale TEXT NOT NULL DEFAULT 'zh',           -- 'zh' | 'en'
  wants_daily_digest INTEGER NOT NULL DEFAULT 1,
  wants_daily_featured INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending',      -- pending|active|unsubscribed|bounced|complained
  confirm_token TEXT NOT NULL,
  unsubscribe_token TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  confirmed_at INTEGER,
  unsubscribed_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS newsletter_subscribers_email_idx        ON newsletter_subscribers(email);
CREATE UNIQUE INDEX IF NOT EXISTS newsletter_subscribers_confirm_tok_idx  ON newsletter_subscribers(confirm_token);
CREATE UNIQUE INDEX IF NOT EXISTS newsletter_subscribers_unsub_tok_idx    ON newsletter_subscribers(unsubscribe_token);
CREATE INDEX        IF NOT EXISTS newsletter_subscribers_status_idx       ON newsletter_subscribers(status);

CREATE TABLE IF NOT EXISTS newsletter_email_sends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_kind TEXT NOT NULL,                    -- 'daily_digest' | 'daily_featured'
  period_key TEXT NOT NULL,                    -- 'YYYY-MM-DD' (UTC date of window end)
  subscriber_id INTEGER NOT NULL REFERENCES newsletter_subscribers(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'sent',         -- 'sent' | 'failed'
  resend_id TEXT,
  error TEXT,
  sent_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
);
CREATE UNIQUE INDEX IF NOT EXISTS newsletter_email_sends_dedupe_idx ON newsletter_email_sends(email_kind, period_key, subscriber_id);
CREATE INDEX        IF NOT EXISTS newsletter_email_sends_sent_at_idx ON newsletter_email_sends(sent_at);
```

Small tables, no blobs → no INDEXED BY pinning needed; row-layout rule
satisfied (no large TEXT columns).

Re-subscribe semantics: unsubscribed → new subscribe revives the SAME row
(reset status='pending', regenerate confirm_token, keep unsubscribe_token,
update wants_* + locale). Bounced/complained rows are NOT revived by public
subscribe (returns generic ok to avoid oracle) — operator-only unblock.

## 3. Module layout (hexagonal-lite, matching repo conventions)

```
lib/email/
  contracts.ts        EMAIL_KINDS, EmailKind, SubscriberStatus, payload types, from-address constants
  tokens.ts           randomToken() via node:crypto (32B base64url)
  markdown.ts         renderEmailMarkdown(md, opts) — escape-first constrained renderer
  templates/
    layout.ts         shared table shell: header brand, footer (unsubscribe link, web-version link, "由 news.ax0x.ai 发出")
    daily-digest.ts   (column, items, urls) → {subject, html, text}
    daily-featured.ts (stories, urls) → {subject, html, text}
    confirm.ts        (confirmUrl) → {subject, html, text}
  resend.ts           ResendClient port + fetch adapter: sendEmail(), sendBatch(emails, {idempotencyKey}); loud-throw RESEND_API_KEY; non-2xx → typed error (log + throw)
  subscribers.ts      repo layer: subscribeOrRevive, confirmByToken, unsubscribeByToken, listPendingRecipients(kind, periodKey), recordSends
workers/newsletter/send/
  index.ts            runNewsletterSend({now?, dryRun?}) → SendReport — resolves column + featured pool, renders once per kind, personalizes unsubscribe URL, chunks ≤100, ledger-first idempotency
app/api/newsletter/
  subscribe/route.ts  POST — zod {email, locale?, kinds?}; rate-limited (new family 'newsletter-subscribe', e.g. 10/min); always {ok:true} on valid email (no enumeration oracle); sends confirm email
  confirm/route.ts    GET ?token= → redirect /{locale}/newsletter?status=confirmed|invalid
  unsubscribe/route.ts GET ?token= → redirect /{locale}/newsletter?status=unsubscribed|invalid ; POST (RFC 8058 One-Click) → 200
app/api/cron/newsletter-send/route.ts   GET via runCronJsonRoute → runNewsletterSend()
components/newsletter/subscribe-card.tsx 'use client' — login-form pattern; two variants: `full` (newsletter page) and `inline` (daily page, single-row email+button, links to /newsletter for kind preferences)
app/[locale]/newsletter/page.tsx        ViewShell + PageHead + status banner + SubscribeCard(full) + what-you-get explainer (see §5b)
```

Wiring changes: `vercel.json` (+`40 5 * * *`), `scripts/ops/run-cron.ts`
(CRON_RUNNERS `newsletter-send`), `lib/shell/system-stats.ts` (activity =
`max(newsletter_email_sends.sent_at)`), `lib/shell/nav-data.ts` (NAV_PRIMARY
`{id:'newsletter', href:'/newsletter', label:'Newsletter', cjk:'订阅'}`),
`messages/{en,zh}.json` (`newsletter` namespace), subscribe-card also embedded
on `app/[locale]/daily/page.tsx`, `.env.example` (+RESEND_API_KEY section),
`scripts/verification/environment-policy.ts` (+`RESEND_` controlled prefix),
`scripts/verification/run-hermetic-tests.ts` (+fake `RESEND_API_KEY`).

## 4. Send algorithm (idempotent, retry-safe)

```
runNewsletterSend(now):
  column   = latest newsletters row: kind='daily', locale='zh', columnTitle NOT NULL,
             period_end within last 26h          — else skip daily_digest ("no-column")
  periodKey = utcYmd(column.periodEnd)           — same key for both kinds
  featured = items tier IN ('featured','p1'), enriched in [column.periodStart, column.periodEnd),
             order importance DESC, cap 10       — if 0 rows skip daily_featured ("no-featured")
  for kind in [daily_digest, daily_featured]:
    recipients = active subscribers wanting kind
                 LEFT JOIN sends ON (kind, periodKey, subscriber) WHERE sends.id IS NULL
    if none → skip ("all-sent" | "no-subscribers")
    render body once; per-recipient: inject unsubscribe URL (token)
    chunks of ≤100 → resend.sendBatch(chunk, {idempotencyKey: stable per §1.8})
      per-email headers: List-Unsubscribe: <https://news.ax0x.ai/api/newsletter/unsubscribe?token=…>,
                         List-Unsubscribe-Post: List-Unsubscribe=One-Click
    on chunk success → insert ledger rows (status='sent', resend ids)
    on chunk failure → log loud, insert NOTHING (next run retries), continue other chunks
  return SendReport {kind results, sent/skipped counts, durationMs}
```

`dryRun` renders + counts but calls no network — used by ops smoke and tests.

## 5. Email templates (NLE-2) — design contract

- Invoke `Skill(skill="frontend-design")` BEFORE writing template code.
- Table layout, max-width 600px, ALL styles inline, no external assets except
  links; no JS; alt text everywhere; both `html` and `text` parts.
- Dark-native: bg `#0a0a0a`, card `#0d1117`, border `rgba(255,255,255,0.08)`,
  text `#f0f6fc`, secondary `#8b949e`, links `#58a6ff`, accent green `#3fb950`.
  Set explicit `color` AND `bgcolor`/`background-color` on every cell so
  clients that force-repaint stay legible; verify legibility if backgrounds are
  stripped (Gmail dark-mode quirks). Monospace accents via
  `ui-monospace, 'JetBrains Mono', Menlo` stack (no webfont loading).
- Header: brand line `AX 的 AI 雷达 · AI RADAR` + date; theme_tag as a chip.
- 日报 subject: `【AX 日报】{columnTitle}`; body = lede (summary_md) →
  narrative sections (##→styled h2) → 精选 callout (featured items) → footer.
  Web version link → `https://news.ax0x.ai/zh/daily/<date>`.
- 精选 subject: `【AX 精选】{top item title} 等 {N} 条`; body = per item:
  linked title (external `items.url`), source/tier/importance meta line,
  summary, 锐评 (editor_analysis) as styled blockquote.
- `[#NNNN]` refs in narrative: resolve id→item via column.itemIds map — link
  the ref text to the item's external URL; unresolvable → strip to plain text.
  NEVER link to `/zh/items/<id>` (route does not exist).
- Footer: unsubscribe link (per-recipient token URL), site link, sender note.
- Size budget: < 90KB HTML (Gmail clips at 102KB) — assert in tests with a
  max-size fixture.
- XSS: renderer escapes ALL content before markup insertion; test with
  `<script>`/`<img onerror>` fixtures (content is LLM/feed-derived = untrusted).

## 5b. Site UI spec (NLE-5) — design-review hardened

**Information architecture** — `/{locale}/newsletter` top-to-bottom:
1. PageHead (`en="Newsletter"`, `cjk="邮件订阅"`, extra: RSS link) — reuses the
   bilingual page-head contract every view has.
2. Status banner (only when `?status=` present) — `role="status"`, dismissable
   by navigation only. confirmed → green border/text; unsubscribed → neutral;
   invalid → `--color-negative`.
3. SubscribeCard `full`: mono terminal-prompt header line `$ subscribe --daily`
   (matches the daily page's `cat newsletter/daily/*.md` crumb aesthetic — NOT
   a generic SaaS newsletter box), email Input, two kind checkboxes with
   one-line descriptions, primary Button.
4. What-you-get explainer: two rows (日报 / 精选), each = kind name + one-line
   content description + send time "每天 13:40 (北京时间)" + a "预览" link to
   `/zh/daily` (digest) so the user sees real content before subscribing.

Daily index page embed: SubscribeCard `inline` directly under PageHead —
single row `[email input][订阅]` + caption linking to `/newsletter`.

**Interaction states** (what the user SEES):

| Surface | idle | sending | success | error-validation | error-rate-limit/server |
|---|---|---|---|---|---|
| Subscribe form | input + CTA enabled | button spinner (Loader2), inputs disabled | card body swaps to "去邮箱点一下确认链接就生效 📬" + the submitted address; no form re-shown | inline `role="alert"` under input: "邮箱格式不对" | inline alert: "稍后再试" (429) / "出错了，稍后再试" (5xx); form stays editable |
| Confirm landing | — | — | banner: "订阅已生效 — 明天 13:40 见 📡" + link 去看今日日报 | — | invalid/expired token banner + SubscribeCard(full) to redo |
| Unsubscribe landing | — | — | banner: "已退订，不再打扰。" + 一键重新订阅 (pre-filled) + RSS alternative | — | invalid token banner + card |

Already-active email re-subscribe → same success copy (no enumeration oracle).

**Journey / emotional arc** (5-sec / 5-min / long-term): card promises concrete
value with a real preview link (visceral trust) → success state sets an exact
expectation (明天 13:40) instead of a vague "thanks" → confirm email lands
within a minute (behavioral trust) → every email footer keeps one-click exit
(long-term trust: leaving is easy, so staying is a choice).

**Responsive & a11y**: inline variant stacks input above button < 640px; touch
targets ≥ 44px; email input has i18n `aria-label` + `type="email"` +
`autocomplete="email"`; checkboxes are real `<input type=checkbox>` wrapped in
`<label>`; status/error text via `role="alert"`/`role="status"` (login-form
precedent); focus-visible uses the existing cyan ring token; color contrast on
`#0a0a0a` uses existing token pairs only (already AA-checked by the shell).
All copy through `messages/{en,zh}.json` `newsletter` namespace.

## 6. Tests (TDD — failing test first per phase)

| Area | Tests (hermetic, colocated `*.test.ts`) |
|---|---|
| markdown.ts | headings/bold/blockquote/lists/paragraph split; `[#NNNN]` resolve+strip; HTML escaping incl. script/onerror fixtures; CJK spacing preserved |
| templates | snapshot per kind w/ fixture content; subject shapes; size budget; unsubscribe URL present; text part non-empty |
| resend.ts | injected fake fetch: auth header, batch ≤100 enforced, idempotency key passthrough, non-2xx → typed loud error |
| subscribers.ts | file-backed libSQL: subscribe→pending+confirm token; confirm→active; unsubscribe→unsubscribed; revive resets correctly; bounced not revived; email lowercased; ledger dedupe unique |
| send worker | fake resend + hermetic DB: happy path both kinds; second run = full no-op (ledger); no-column skip; no-featured skip; chunking >100; failed chunk retried next run without double-sending succeeded chunk |
| API routes | zod rejects bad email; rate-limit 429; no-enumeration (same response for new/dupe); confirm/unsub redirect targets; RFC 8058 POST returns 200 |
| migration | runner registers in schema_migrations w/ checksum; re-run = no-op; checksum mismatch throws |

Gates: `bun run verify` (all 7 stages) + `bun run verify:public-boundary` green.

## 7. Phases & acceptance

| Phase | Scope | Acceptance | Status |
|---|---|---|---|
| NLE-1 Contracts+DB | contracts, tokens, schema.ts tables, migration module + ops script | migration tests green; `bun run typecheck` green | **done** 2026-07-16 |
| NLE-2 Email core | markdown renderer, templates (frontend-design skill first), resend adapter | unit+snapshot tests green; size budget asserted | **done** 2026-07-16 |
| NLE-3 API | subscribe/confirm/unsubscribe routes, rate-limit family, subscribers repo | route+repo tests green; no-enumeration verified | **done** 2026-07-16 |
| NLE-4 Send pipeline | send worker, cron route, vercel.json, run-cron.ts, system-stats signal | worker tests green incl. idempotency; `bun scripts/ops/run-cron.ts newsletter-send` works locally w/ dryRun | **done** 2026-07-16 |
| NLE-5 UI | subscribe card, /newsletter page, daily-page embed, nav, i18n both locales | visual verify (screenshot sweep zh+en covering every §5b state); lint/build green | **done** 2026-07-16 |
| NLE-6 Verify+docs | full `bun run verify` + `verify:public-boundary`; update README surfaces table, docs/architecture/overview.md, docs/agent-access if API surface documented, `.env.example`; this PLAN marked shipped | all gates green; docs consistent | **done** 2026-07-16 |
| NLE-7 Ops | see runbook §8 | prod smoke evidence | **done** 2026-07-16 — migration applied (`20260716_newsletter_email_v1`, checksum 2845567a…), full real-send smoke passed (subscribe → confirm email → confirm → 日报+精选 delivered via Resend, ledger written, re-run = all-sent no-op), RESEND_API_KEY in Vercel prod/preview/dev. Remaining: DMARC TXT absent — recommend `v=DMARC1; p=none;` on `_dmarc.news.ax0x.ai` (report-only) |

Dependencies: NLE-2,3 ← NLE-1; NLE-4 ← NLE-1+2; NLE-5 ← NLE-3; NLE-6 ← all; NLE-7 last.

## 8. Ops runbook (NLE-7 — each step CONFIRM-BEFORE-ACTION with the user)

1. **Apply migration** (additive CREATE IF NOT EXISTS; Turso has NO backup —
   still confirm): `bun --env-file=.env.local scripts/ops/migrate-newsletter-email.ts --apply`
2. **Vercel env**: add `RESEND_API_KEY` to production+preview+development
   (`vercel env add`). (Pre-authorized: user supplied the key for this purpose.)
3. **Deploy** (normal merge→deploy flow; PR first per §9).
4. **Prod smoke**: subscribe own email via prod UI → confirm link → trigger
   `newsletter-send` once via authorized curl w/ CRON_SECRET → verify email
   received (both kinds), unsubscribe link works, ledger rows written,
   re-trigger is a no-op.
5. **DMARC check**: `dig TXT _dmarc.news.ax0x.ai` — if absent, recommend
   `v=DMARC1; p=none;` record (report-only) in Cloudflare.

## 9. Open unknowns & assumptions (risk-ordered)

1. `publicRateLimit` keying/behavior for anonymous POST — read
   `lib/rate-limit/public.ts` at NLE-3 start; if unsuitable, add a sibling
   limiter reusing the family config shape.
2. Gmail dark-mode color inversion on the dark palette — mitigated by explicit
   per-cell colors; judged at prod smoke (step 4). Fallback: light template
   variant (follow-up, not v1).
3. Resend free-tier quota (assumed 100 emails/day, 3k/mo) — fine for launch
   list; revisit before any promotion push.
4. Bounce/complaint suppression webhook (`/api/webhooks/resend`) — DEFERRED
   follow-up (svix signature verify + status flip). v1 relies on Resend's
   account-level suppression.
5. Admin subscriber-count card on /admin/system — deferred follow-up.
6. en daily email — blocked on en daily column not existing; featured-only en
   email possible later (items bilingual).
7. `users` table is unrelated to subscribers (admin session identity) — keep
   separate; no FK between them.

## 10. Execution-session hard rules (copied from repo law — violations = stop)

- NEVER run `db:push` / `drizzle-kit push` / accept any diff touching
  `items.embedding`.
- Schema changes ONLY via the checksummed runner + `--apply` script; migration
  apply to prod REQUIRES explicit user confirmation in-session.
- No real network in tests (hermetic policy strips/fakes creds; add `RESEND_`
  prefix to controlled list in the same phase that introduces the adapter).
- Errors loud (log + rethrow); collection boundaries annotate-and-continue.
- Subscriber data stays out of the public snapshot/boundary.
- All UI strings through `messages/{en,zh}.json`; nav labels inline in nav-data.
- PR only after `bun run verify` green locally (PR Readiness Gate).
