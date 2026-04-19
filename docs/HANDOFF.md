# AX's AI RADAR — Session Handoff (2026-04-18/19, Session 7 complete)

> Read this first before resuming. Sessions 1-3 = M0-M2 + RSS/commentary/newsletter/i18n/cost/perf/HKR/bilingual. **Session 4** = Jina body fetch + 晚点 prompts + per-axis HKR + concurrency fan-out + YouTube transcripts + `/podcasts` UI. **Session 5** = M3 auth+feedback+admin-gate MERGED + podcast detail + CRON_SECRET fix + commentary depth-rewrite x2. **Session 6** = M4 editorial agent MERGED · X ingestion MERGED · feed source filter + /all sidebar route · Supabase auth ripped out in favour of password gate · 20 broken sources disabled. **Session 7 (this one)** = **2026 backfill (+2907 items) · full terminal-aesthetic frontend port (12 views) · named saved-collections + server-side tweaks persistence · policy editor + iterations timeline** — 12 of 14 catalogued design-mock divergences closed.

> ### ⚠ Session 8 first task: **triage the user's bug reports**
>
> User flagged at end of s7: "a lot of issues needs to be fixed in next session." They did NOT enumerate which ones. **Read [`docs/SESSION8-PUNCHLIST.md`](./SESSION8-PUNCHLIST.md) FIRST** — it has a pre-built punch list of plausible issues (mobile layout unverified, tweaks sync floods on rapid change, stale `?collection` URLs, native confirm() dialogs ugly on mobile, etc). Ask the user to name the specific bugs they saw, cross-reference against the punch list, then triage from there.

---

## TL;DR — where the project is at end of session 7

- **Live**: https://news.ax0x.ai
- **Repo**: https://github.com/xingfanxia/newsroom — session 7 merged **2 PRs** (#11 terminal port + backfill, #12 divergence close-out)
- **Brand**: AX's AI RADAR / AX 的 AI 雷达 — **new aesthetic**: terminal-forward with HKR ring, green/orange/blue accents, JetBrains Mono + Noto Sans/Serif SC. Replaces the previous cyan observatory look.
- **Auth**: still password-gated via `ADMIN_PASSWORD` env.
- **Data state**:
  - **items**: **6216 total · 5146 enriched (83%)** · 941 curated · 1967 with commentary · 2755 with body_md
  - **raw_items**: 6224 · 0 pending normalize
  - **sources**: 72 total, 45 enabled, 27 disabled — unchanged from s6
  - **feedback**: 10 rows (unchanged — fixture seed)
  - **saved_collections**: 0 (new table; nobody's created one yet)
  - **policy_versions**: 1 (seeded from disk); iteration_runs: 0 (agent still never triggered through prod UI)

### Content distribution — s6 gap closed

```
              before s7  →  after s7
2026-04        1,216     →   2,827  (X April backfill + active hourly cron)
2026-03          169     →   1,164  (Wayback backfill)
2026-02           76     →     290
2026-01           67     →     304
```

The s6-handoff concern "content volume is not good enough" is resolved. All four months of 2026 now carry real volume. ArXiv cs.CL alone contributed ~1996 papers (don't over-weight that — still real signal, just heavily weighted to research).

---

## Session 7 shipped

### PR #11 — 2026 backfill + full terminal-aesthetic port (`5181d44`)

**Backfill toolkit**
- `lib/backfill/wayback.ts` — CDX API client with daily-collapse + weekly sampling + digest-dedup. Fetches raw snapshots via `/web/<ts>id_/` (no Wayback chrome injection).
- `lib/backfill/runner.ts` — per-source strategy dispatch. Wayback for RSS/Atom/RSSHub, ArXiv native search (`?search_query=cat:…+AND+submittedDate:[…]`) for arxiv-cs-*, skip for unimplementable kinds.
- `workers/fetcher/x-api.ts` — extended with `fetchHistoricalForHandle` (start_time/end_time + pagination_token).
- `scripts/ops/backfill-source.ts` + `scripts/ops/backfill-x.ts` + `scripts/ops/drain-normalizer.ts` — the triptych. `backfill-source.ts --all` ran against 33 sources in ~15 min, `backfill-x.ts` ran April-only for 7 handles in seconds.

**Net result**: 2681 new RSS raw_items + 226 X raw_items = **2907 new items normalized**. 307 X reads billed (all within Basic-tier quota).

**Terminal design port** (replaces the cyan observatory aesthetic end-to-end)
- `app/globals.css` + `app/terminal.css` — terminal tokens (`--bg-0..3`, `--fg-0..3`, `--accent-green/blue/orange/purple/red/yellow`) + full 1400-line layout CSS from the handoff bundle. Body data-attrs wire theme/accent/radius/chrome/score/density/lang/linenum/mutedmeta.
- `components/shell/` — `TopBar` (lights + crumbs + sysinfo), `LeftRail` (brand + search + nav + pulse-box + site-config + logout), `ViewShell` wrapper, `Tweaks` (site-config panel with ⌥, toggle), `MobileChrome` (bottom tab bar + drawer), `PageHead`, `BrandLogo`.
- `components/feed/` — `Item` (replaces StoryCard), `HkrRing`, `Ticker`, `RadarWidget`, `RightRail`.
- `hooks/use-tweaks.tsx` — TweaksProvider + context, localStorage-first with legacy `"both"` → `"en"` migration.
- 12 views ported to ViewShell with real DB queries: `/`, `/all`, `/saved`, `/sources`, `/podcasts`, `/podcasts/[id]`, `/low-follower`, `/x-monitor`, and admin `/system /policy /iterations /users /usage` (new route).
- 11 legacy files deleted (old Sidebar, StoryCard, TimelineRail, tag-chip, score-badge, cross-source-indicator, feedback-controls, coming-soon, old topbar, _hot-news-tabs, _source-filter).
- 20 new tests: 12 Wayback unit + 8 nav/tweaks config tests.

### PR #12 — close 12 of 14 design-mock divergences (`8c073ad`)

After the initial port, I catalogued every visual or functional gap vs the mock. 12 closed this PR; 2 deferred on externalities:

| # | Item | Status |
|---|---|---|
| 1 | Named saved collections | ✅ table + FK + CRUD + UI |
| 2 | Saved-meta strip per item | ✅ |
| 3 | Saved tags sidebar | ✅ |
| 4 | Export MD | ✅ `/api/saved/export` |
| 5 | Tweaks server persistence | ✅ `users.tweaks` + `/api/tweaks` |
| 6 | X Monitor handles sidebar | ✅ |
| 7 | Sources cards toggle | ✅ `?view=cards` |
| 8 | Podcasts channel filter | ✅ inline pills |
| 9 | Low-follower viral cards | ⏸ blocked on X `/2/tweets/search/all` quota |
| 10 | Admin Policy editor | ✅ split editor + commit-as-new-version |
| 11 | Admin Iterations timeline | ✅ vertical `VersionTimeline` |
| 12 | Dynamic ticker | ✅ from top-importance last 24h |
| 13 | User watchlist config | ✅ inline edit in right rail |
| 14 | Mobile QA | ⏸ needs real browser |

**Schema added**:
- `saved_collections` — user-scoped folders with `pinned` + `sort_order`
- `feedback.collection_id` — nullable FK to `saved_collections`, `ON DELETE SET NULL` so deleting a collection reparents saves to the inbox rather than losing them
- `users.tweaks` jsonb — mirrors `Tweaks` shape from `hooks/use-tweaks.tsx`
- `users.watchlist` jsonb — string[] up to 24 terms

All applied via `bun run db:push`. HNSW halfvec index recreated post-push (known drizzle gotcha #6 from s4/s7).

**New APIs**:
- `GET/POST/PATCH/DELETE /api/admin/collections`
- `POST /api/feedback/move`
- `GET/PATCH /api/tweaks`
- `POST /api/admin/policy/commit` — direct human-authored policy update (no agent)
- `GET /api/saved/export?collection=<id|inbox|all>&locale=<en|zh>`

---

## Known gotchas carried forward

1. **Password rotation invalidates cookies** — `ADMIN_PASSWORD` is the HMAC key. Feature, not bug.

2. **M4 agent: `reasoningEffort: "medium"` only** on the pro deployment — higher effort + 12KB prompt + structured output = hard 5-min Azure ceiling.

3. **Commentary `maxTokens = 6144`** + the `<before>/<after>` block in `workers/enrich/prompt.ts` is load-bearing. Don't touch in refactors.

4. **`stripHtml` was broken for months pre-PR#6** — 3000+ legacy items have `body=""`. Re-extractable from rawPayload if a future pass wants to backfill.

5. **rsshub.app is dead to us** — 8 rsshub sources disabled since s6. Self-hosting an RSSHub Docker container is the unlock.

6. **drizzle-kit push drops the HNSW index** every time because it doesn't understand the `halfvec_cosine_ops` operator class. Always run `bun run db:hnsw` after `bun run db:push`.

7. **Vercel env baked at deploy time** — `vercel env add X=Y` alone doesn't take effect; follow with `git commit --allow-empty && git push` to trigger rebuild.

8. **Azure reasoning throttle still binds** — `reasoning_effort: "high"` caps at ~6-7 calls/min on the standard deployment regardless of TPM quota.

9. **X pay-per-tweet cost discipline** — `since_id` cursor on `source_health.lastExternalId` keeps steady-state cost near zero. First tick after a cold deploy pays ~140 reads (20 × 7 handles); subsequent ticks drop to 0-3.

10. **`tweaks` localStorage migration** — legacy `"both"` language value auto-normalises to `"en"` on load. Removed from the UI as of s6 but older saved configs still round-trip through the migration.

11. **`getFeaturedStories` has no per-source filter** — only group or kind. `/x-monitor` and `/podcasts` emulate per-source filtering by client-side filtering on `story.source.publisher`. If per-source rendering gets more pages, add a `sourceId` param to `FeedQuery`.

12. **Key rotation still deferred** — OpenAI/Anthropic/Gemini/Azure/Jina keys from s3-4 chat history. 10-min task per provider. Still explicitly deferred across four sessions now; bundle at next session start if the user cares.

---

## Session 8 resume guide

### Deferred from s7 (pick one + do)

- **#9 Low-follower viral cards** — requires X API `/2/tweets/search/all` endpoint. Check tier quota (current Basic is $200/mo, doesn't include `search/all` — that needs Pro at $5k/mo or academic access). If decided against, delete the nav link + `/low-follower` route entirely; don't leave a ComingSoon.
- **#14 Mobile viewport QA** — open DevTools → responsive mode (720px breakpoint) on `/`, `/saved`, `/admin/iterations`. Catch: `.m-tabbar` visible + tappable, `.saved-layout` collapses to single column, right rail hides, filter pills horizontally scroll.

### Nice-to-have polish

- **Podcast detail `/podcasts/[id]`** uses inline styles extensively. Extract to a small scoped CSS module if we add more detail pages (e.g. an article-detail view).
- **Admin hero panel** in `/admin/iterations` still uses `surface-featured` + Tailwind-first classes. Port to `.panel` or inline styles for consistency.
- **Tweaks panel server-side watchlist** — when we eventually hydrate watchlist counts per term (requires a nightly job counting matches across recent items), surface them next to each term. Today the watchlist is just a bookmark-list of strings.
- **iteration_runs view** — ops might want a list of runs (running/proposed/applied/rejected/failed history) separately from the version timeline.

### Housekeeping

1. Run `gh pr merge --squash --delete-branch` if any feature branches stick around.
2. The `x-ai-watchlist` source row is still in the DB even though the catalog no longer defines it. Low priority — it's `kind='api'` which the fetcher skips.
3. Legacy Supabase env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) still set on Vercel. Unused since s6. Remove via `vercel env rm`.

---

## Operations quick-ref

### Running the ops scripts

```bash
# Data state snapshot
bun --env-file=.env.local scripts/ops/check-data-state.ts

# Backfill a single source
bun --env-file=.env.local scripts/ops/backfill-source.ts <sourceId> \
  --from 2026-01-01 --to 2026-04-18 --dry-run

# Drain normalizer to empty
bun --env-file=.env.local scripts/ops/drain-normalizer.ts

# Re-seed catalog
bun --env-file=.env.local scripts/ops/seed-sources.ts

# Trigger X historical (costs money — confirm first)
bun --env-file=.env.local scripts/ops/backfill-x.ts \
  --from 2026-04-01 --to 2026-04-18 --dry-run
```

### Schema changes

```bash
# Make schema edits in db/schema.ts, then:
bun --env-file=.env.local run db:push        # writes the ALTERs
bun --env-file=.env.local run db:hnsw        # re-creates the halfvec index
```

### Collections quick-probe

```bash
bun --env-file=.env.local -e '
import("./db/client").then(async m => {
  const {sql} = await import("drizzle-orm");
  const db = m.db();
  console.log(await db.execute(sql`SELECT * FROM saved_collections`));
  await m.closeDb();
})
'
```

---

## Memory files auto-loaded per session

Living at `~/.claude/projects/-Users-xingfanxia-projects-portfolio/memory/`:

- `project_newsroom_state.md` — this session's snapshot
- `feedback_azure_reasoning_throttle.md`
- `feedback_cron_secret_gotcha.md`
- `feedback_prompt_prescription_vs_demonstration.md`
- `feedback_yage_romanization.md`
- `feedback_current_gen_models.md`
- `feedback_secret_handling.md`
- `feedback_image_reading.md`
- `project_azure_resources.md`
- `project_portfolio_layout.md`

New this session: none — every session-7 learning (terminal port strategy, HNSW drizzle gotcha, Wayback sampling cadence, X historical billing) is captured here in HANDOFF.md rather than duplicated as separate memories.

---

End of session 7 handoff.
