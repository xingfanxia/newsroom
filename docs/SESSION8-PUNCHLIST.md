# Session 8 — issue punch list

> Archived historical snapshot. Use `docs/README.md`, `docs/HANDOFF.md`, current
> runtime code, and tests as implementation guidance. Checked items below may
> have been resolved after this list was written.

Written at the end of s7 (2026-04-19). User flagged "a lot of issues needs to be fixed" without specifying. This doc enumerates everything I suspect could be wrong, grouped by type + severity, so s8 can triage fast.

**First thing s8 must do**: ask the user to list the specific issues they saw. Cross-reference against this doc. Anything matching → go straight to fix. Anything unmatched → add to this doc.

---

## A — user-flagged (carried over)

- [x] **Left-rail Chinese labels used Noto Serif SC while feed items used OS-fallback sans** — root cause was `--font-mono` having no CJK fallback. Fixed in `b161044`. **Verify on the Vercel production deploy before closing.**

## B — visual port loose ends (not browser-tested after port)

- [ ] **Mobile 720px layout** — `.m-tabbar`, `.m-drawer`, card-style feed, horizontal-scroll filters — CSS is wired in `app/terminal.css` but never QA'd in a real viewport. Open DevTools responsive mode and walk through `/`, `/saved`, `/sources`, `/admin/iterations`.
- [ ] **Tweaks panel toggles** — verify each lever actually does what the label says:
  - [ ] `theme` → 4 palettes (midnight/obsidian/slate/paper). Paper mode was the mock's light-theme concept; CSS exists but may have unreadable text.
  - [ ] `accent` → 6 colors remap `--accent-green`. Live UI should shift immediately.
  - [ ] `radius` → sharp/subtle/soft/pill. `body[data-radius] .item/.panel/etc` selectors gate this.
  - [ ] `scoreStyle` → ring/bar/tag/none. Should reshape the right-column of every `.item`.
  - [ ] `chromeStyle` → clean mode should hide topbar lights + crumbs; brutalist mode should square everything.
  - [ ] `density` → compact/comfy/reader changes padding + title size + summary visibility.
  - [ ] `mutedMeta` / `showLineNumbers` — the CSS is there; verify toggles flip the UI.
- [ ] **Right-rail watchlist edit mode** — does the "edit" button actually toggle `editing=true` and reveal ✕ buttons? What about the add-new input-on-Enter behaviour?
- [ ] **Admin hero panel** in `/admin/iterations` still uses `surface-featured` + Tailwind-first classes (`lg:grid-cols-[1fr_352px]`, `text-[24px]`). Polish to the `.panel` aesthetic.
- [ ] **Podcast detail `/podcasts/[id]`** uses inline styles exclusively (no classes). Renders but might feel different from other pages. Extract to a scoped CSS module if we add more detail pages.
- [ ] **Ticker visual** — what if `getRecentTickerItems` returns 0 items (cold DB)? Fallback shows 2 placeholder entries; verify the marquee animation works with only 2 items (might pause weirdly).
- [ ] **Site-config floating panel** position/z-index on narrow viewports — the `.tweaks` panel is `position: fixed; bottom: 20; right: 20` which could overlap the mobile tabbar (60px tall at the bottom).

## C — functional bugs likely lurking

- [ ] **Saved page with stale `?collection=<id>`** — URL points at a deleted collection id. Server falls through to inbox but URL still says the old id. Either rewrite URL to `?collection=inbox` on fallback or 404.
- [ ] **Tweaks server-sync floods** — every tweak mutation fires PATCH `/api/tweaks`. Scrubbing through theme/accent rapidly sends 6-10 requests in a second. Add 500ms debounce.
- [ ] **Policy editor: close-tab loses drafts** — no confirmation on unload with unsaved changes. Window `beforeunload` handler needed.
- [ ] **Policy editor: no diff preview before commit** — user commits blindly. Should show a `DiffViewer` of old vs new content + confirm step.
- [ ] **Named collections UI uses native `confirm()` / `prompt()`** — ugly on mobile, no styling. Replace with a sonner-based inline confirm or a proper modal.
- [ ] **Watchlist: case-insensitive dedup missing** — adding `"GPT-6"` after `"gpt-6"` creates two entries. Normalize to lowercase before compare.
- [ ] **X Monitor filter by handle uses `s.source.publisher` string match** — fragile. If two handles share a nameEn/nameZh string the filter leaks. Requires adding `sourceId` to `FeedQuery` (see Gotcha 11 in HANDOFF).
- [ ] **Podcasts filter by source uses the same publisher match** — same bug class.
- [x] **Export MD omits `editor_analysis` long-form** — resolved; saved export now includes `editor_analysis` when distinct from `editor_note`, and rendering lives in `lib/api/saved-export.ts`.
- [ ] **CollectionSidebar "more" context menu** — positioned `right: 6; top: 100%` absolute. On the last row near the bottom of a short viewport, it renders below the fold / off-screen.
- [ ] **Feedback move** endpoint returns 404 if the save doesn't exist. But the UI doesn't disambiguate "you don't own this save" vs "it's already been removed". Probably fine, document.
- [ ] **Delete collection cascade** — saves get reparented to inbox (SET NULL). The UI optimistically routes to inbox via `go("inbox")` — but `router.refresh()` fetches the new inbox count, which might race with the DELETE. Verify the revalidation order.

## D — functional gaps (deferred, explicit)

- [ ] **#9 `/low-follower` still coming-soon** — blocked on X `/2/tweets/search/all` quota. Decision needed: pay for X Pro, or delete the nav route (currently dangles).
- [ ] **`/admin/users` still coming-soon** — single-user mode under password gate, so a user-management screen is cosmetic until multi-user returns. Low priority.
- [ ] **Admin Policy editor: live preview is just `<pre>{content}</pre>`** — no actual markdown rendering. If the policy becomes significantly longer, the preview should use the same Prose/markdown component as podcast detail.
- [ ] **Iterations timeline is read-only** — no "revert to v{n}" button. Useful if a bad commit lands.
- [ ] **Saved page has no search** — if a user saves 200 items, scrolling is the only way to find one.

## E — operational hygiene

- [x] **Enrich pipeline on backfilled items** — verified on 2026-06-15 via
  read-only DB queue checks that the backfilled raw-item backlog had drained
  through normalize/enrich/score. Live queue depths are expected to fluctuate
  as fresh cron items arrive; use `/admin/system` or direct DB queue checks for
  current counts.
- [ ] **`x-ai-watchlist` source row still in DB** — catalog no longer defines it but the seed script doesn't delete rows. Either add a catalog-deletion pass to `seed-sources.ts` or manually `DELETE FROM sources WHERE id = 'x-ai-watchlist'`.
- [ ] **Supabase env vars on Vercel** — `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` unused since s6 password-gate swap. `vercel env rm` to clean up.
- [ ] **Key rotation** — OpenAI/Anthropic/Gemini/Azure/Jina keys have been in chat history since s3-4. 5-min task per provider. Deferred 4+ sessions running.
- [ ] **`iteration_runs` never exercised through prod UI** — the M4 agent end-to-end flow still untested on production. First run is available in `/admin/iterations`.

## F — testing gaps introduced in s7

- [x] No integration tests for `/api/admin/collections` CRUD (create/patch/delete/list) —
  shared CRUD semantics covered by `tests/api/collections.test.ts` and
  route wiring covered by `tests/api/collections-source.test.ts`.
- [x] No test for `/api/feedback/move` reparent behaviour — covered by
  `tests/api/saved-routes.test.ts` and
  `tests/api/saved-routes-source.test.ts`.
- [x] No test for `/api/admin/policy/commit` writes correct `version+1` —
  covered by `tests/api/policy-commit.test.ts`.
- [x] No test for `/api/saved/export` markdown shape — covered by `tests/api/saved-export.test.ts`.
- [x] No test for `/api/tweaks` GET+PATCH round-trip — shared helper
  contract and real DB persistence covered by `tests/api/tweak-routes.test.ts`.
- [ ] `getFeaturedStories` per-source-filter workaround (client-side `s.source.publisher` match) has zero test coverage
- [ ] `useTweaks` TweaksProvider not tested for context propagation

## G — design-mock divergences still open

From the original catalog of 14 at s7 start:

- [ ] **#9 Low-follower viral cards** — see D above
- [ ] **#14 Mobile viewport QA** — see B above

---

## Suggested session 8 kickoff

1. `git checkout main && git pull` — ensure synced
2. `bun --env-file=.env.local run db:ping` — verify DB
3. Ask user: **"List the specific issues you saw. I have a pre-built punch list at `docs/SESSION8-PUNCHLIST.md` to cross-reference."**
4. For each user-reported issue, find it in this doc or add a new entry
5. Triage: user-reported first, then browser-QA (section B), then functional bugs (section C)
6. Batch related fixes into a single PR; keep ops hygiene (section E) separate

## Pre-flight commands

```bash
cd ~/projects/portfolio/newsroom
git pull --ff-only
vercel env pull .env.local --yes
bun install && bun test && bun run build
bun run db:ping
bun --env-file=.env.local scripts/ops/check-data-state.ts
```

All 5 should return success. Any failure → start there before touching UI.
