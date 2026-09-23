# Production Monitoring and Cron-Outage Recovery

Current source of truth for the production health monitor and for recovering
from a stretch where crons did not run. Incident history lives in
[`../HANDOFF.md`](../HANDOFF.md); cron behavior lives in
[`../architecture/ingestion.md`](../architecture/ingestion.md).

## Invariant: only git builds may target production

The project's cron set follows production-target deployments — observed
2026-09-07, when a staged `vercel deploy --prod --skip-domain` that never took
the custom domain still rebound the cron set to its own `vercel.json`. That
deployment was built from a throwaway audit directory with no `crons` key, so
all 13 crons stopped for ~78h while `news.ax0x.ai` kept serving the previous
deployment and looked healthy.

Production deployments come only from the git integration on `main`. Never
create a CLI deployment with a production target against this project — not
`vercel --prod`, `vercel deploy --prod`, or `--target=production`, and not with
`--skip-domain`, `--prebuilt`, or a non-repo `--cwd`. To read production env
values, use `vercel env ls production` (names) and
`vercel env pull --environment=production <file>` (non-sensitive values);
Sensitive values are unreadable by design — record them as such. A preview
deployment sees Preview-scoped values, not production ones.

Instant rollback: Vercel's docs disagree on whether a rollback moves the cron
set, and a rollback turns off automatic production-domain assignment, so later
git deploys from `main` stay STAGED until someone runs
`vercel promote <git-built deployment>`. After any rollback or promote, run the
binding check below with a token and undo the rollback once the fix is on
`main`.

## Monitor

`.github/workflows/production-health-monitor.yml` runs
`scripts/ops/check-production-health.ts` hourly at `:07` on GitHub Actions and
fails the job (GitHub emails the owner) on any problem. It must never become a
Vercel cron — the failure it detects switches Vercel crons off.

| Check | Signal | Fails when | Needs |
|---|---|---|---|
| Public snapshot freshness | `https://content.ax0x.ai/newsroom/v1/current.json` → `publishedAt` | older than 6h (2x the longest enrich gap in the 30 days before the incident) | nothing |
| Daily column freshness | `https://news.ax0x.ai/api/public/daily?locale=zh` → `window_end` | earlier than the latest 05:00Z boundary once 2h of grace has passed | nothing |
| Cron binding | Vercel `/v9/projects/newsroom` + `/v4/aliases/news.ax0x.ai` | `crons.deploymentId` ≠ `targets.production.id` or ≠ the alias deployment, either id missing, crons disabled, or the registered `{path, schedule}` set ≠ `vercel.json` | `VERCEL_TOKEN` Actions secret |

- **Without `VERCEL_TOKEN`** the binding check logs `cron-binding: SKIPPED` and
  exits 0 if freshness passes — that is not a binding confirmation. Freshness
  alone catches a cron outage within ~6h instead of ~1h. The Actions secret is
  deliberately not configured (owner decision 2026-09-10: a Vercel token is not
  read-only and the repo is public); run the binding check locally with a token
  after any deploy-path change.
- **Daily generation has one recovery tick.** It runs at 05:00Z and 05:20Z.
  Both ticks select the same 05:00Z window; an existing column returns `exists`
  before any model call. The 20-minute spacing exceeds the route's 800-second
  maximum duration, so this retry does not overlap the first scheduled run.
  This recovers a transient model failure without changing the content window
  or the separate 05:40Z email schedule. The 2026-09-22 issue was missed after
  a model timeout while all 13 cron bindings remained healthy.
- **A no-column day still alerts.** When both `newsletter-daily` attempts
  skip (`insufficient-signal`, fewer than 5 stories) or fail, the daily check
  fails every hour until the column publishes. Confirm the cause in the cron
  log; an insufficient-signal backfill would skip again for the same reason.
- **GitHub disables schedules in public repos after 60 days without repository
  activity.** Check `gh workflow view production-health-monitor.yml` and
  re-enable with `gh workflow enable production-health-monitor.yml`.

Thresholds and assessment logic live in `lib/ops/production-health.ts`
(unit-tested in `tests/ops/production-health.test.ts`). Run locally:
`VERCEL_TOKEN=… bun scripts/ops/check-production-health.ts`.

## Recovery runbook

Verified during the 2026-09-10 recovery. bun loads `.env.local` (production
Turso and Resend keys) from the repo root regardless of flags, so every bun
command below writes to production unless marked read-only.

1. **Confirm the binding** (read-only):
   `VERCEL_TOKEN=… bun scripts/ops/check-production-health.ts`, or by hand:
   `vercel api /v9/projects/newsroom` (`crons.deploymentId`,
   `crons.definitions`, `targets.production.id`) and
   `vercel api /v4/aliases/news.ax0x.ai` (`deploymentId`). `vercel crons list`
   shows every cron as `not deployed` when the bound deployment has none.
2. **Rebind**: ship a git production deployment from `main` (merge a PR or push
   to `main`); if a rollback is active, `vercel promote` it instead. Re-run
   step 1: the three deployment ids agree, the definitions match `vercel.json`,
   `disabledAt` is null.
3. **Fetch immediately.** RSS/Atom and AI HOT fetchers keep no watermark (only
   the disabled X adapter uses a `since_id`): they re-read the current feed, so
   gap entries roll off every hour. Trigger every fetch bucket whose schedule
   fell inside the gap (`vercel crons run /api/cron/fetch-hourly`,
   `/api/cron/fetch-daily`, and `/api/cron/fetch-weekly` if a Monday 05:43Z
   passed). Recover AI HOT's gap with
   `bun --env-file=.env.local scripts/ops/backfill-aihot-since.ts <ISO since>`
   (7-day limit). WordPress feeds page back with `?paged=N`.
4. **Drain the pipeline in order**: normalize → article-body → enrich →
   cluster → commentary (`vercel crons run /api/cron/<slug>` runs on
   production with production env). Production has no `JINA_API_KEY`, so
   article-body does 20 items per run; for a backlog run
   `bun --env-file=.env.local scripts/ops/run-cron.ts article-body` with a Jina
   key (300 per run). Enrich only claims items with a fetched body (X status
   URLs excepted) and takes newest first, so check per-window readiness in SQL
   rather than elapsed time. Keep cluster runs clear of the scheduled
   `:55` ticks (no run lock).
5. **Backfill missing daily columns** one window at a time, oldest first, so
   the previous-title check chains:
   `bun --env-file=.env.local -e 'import { runDailyColumn } from "@/workers/newsletter/run-daily-column"; import { runTimeForDailyColumnDate } from "@/workers/newsletter/windows"; console.log(JSON.stringify(await runDailyColumn({ now: runTimeForDailyColumnDate("<window-end YYYY-MM-DD>") })));'`.
   The date is the window END (the site shows the issue under its window START
   date). Never trigger `/api/cron/newsletter-daily` or
   `run-cron.ts newsletter-daily` outside 05:00Z — they window on the current
   hour and write a wrong-hour row that shadows the real issue. Do not use
   `backfill-daily-week.ts` (it force-overwrites existing issues). A missed
   monthly issue has the same trap: `run-cron newsletter-monthly` windows on the
   run date.
6. **Missed emails** (sending is an external action — get explicit approval):
   `NEWSLETTER_SEND_PERIOD_KEY=<window-end date> NEWSLETTER_SEND_DRY_RUN=1 bun --env-file=.env.local scripts/ops/run-cron.ts newsletter-send`
   shows the column, recipient counts, and subjects; drop
   `NEWSLETTER_SEND_DRY_RUN` to send. The ledger makes a repeat a no-op. Only
   the 日报 backfills faithfully — 精选 selects by `enriched_at`, so outage
   windows have no or partial 精选, and the first regular send's 精选 is a
   best-of the backlog.
7. **Publish**: the `publish-public` cron picks up the outbox automatically;
   `vercel crons run /api/cron/publish-public` forces a tick. Verify with the
   monitor script and `/api/public/dailies?locale=zh`.
