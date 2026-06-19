# AX's AI RADAR — Current Handoff

## 2026-06-12 — Code-quality and docs source-of-truth cleanup

Current maintenance direction:
- Start docs navigation from `docs/README.md`; historical plans/handoffs are useful context, not current implementation instructions.
- `bun run verify` is the one-command local quality gate for agents before
  committing: typecheck, lint, build, Knip gates, and the full Bun test suite.
- `bun run lint` is expected to be clean with zero warnings.
- `bun run typecheck` is expected to run standalone `tsc --noEmit` cleanly,
  including tests and Bun runtime APIs.
- `bun run code:dead` is the low-noise Knip gate for unused files/dependencies/unresolved imports and should exit cleanly. `bun run code:dead:exports` checks value exports and `bun run code:dead:types` checks type exports; both should stay clean.
- `upsertAppUser(user)` upserts the effective user row, including API-token users, before FK-owned mutations.

Shipped cleanup:
- Added repo-specific `knip.json` entry/project patterns for Next routes, tests, workers, scripts, and config files.
- Added `bun run verify` as the single local gate that chains typecheck, lint,
  build, dead-code checks, and tests so future agents do not have to infer the
  expected verification order from handoff prose.
- Added `docs/testing/strategy.md` as the current testing/verification strategy
  entry in the docs router.
- Added `docs/architecture/overview.md` as the current architecture map for
  ownership boundaries and change-routing decisions.
- Removed unused UI/source-row components, the unused Tavily integration stub, and unused direct package dependencies.
- Removed/de-exported unused internal value exports across auth, i18n navigation, policy, rate-limit, utility, worker, X API, newsletter, normalizer, and cluster modules.
- Removed/de-exported unused internal type-only exports in the LLM usage and facade modules.
- Added a standalone `typecheck` script backed by `tsc --noEmit`, added Bun
  runtime/test types, and aligned drifting test fixtures so agents can run a
  TypeScript gate without relying on `next build` as the only type signal.
- Replaced stale `tsx` operator-script hints with `bun`.
- Shared resumable operator state-file path/load/save behavior through
  `scripts/ops/state.ts`; backfill scripts keep their own state shape but no
  longer duplicate JSON parsing, `updatedAt` refreshes, or ENOENT handling.
- Shared admin section headings through `components/admin/section-header.tsx`
  and moved `/admin/usage` task/model/recent-call tables into a private
  `_usage-tables.tsx`, so the page owns data orchestration instead of table
  rendering details.
- Shared admin table shell styling through `components/admin/table-frame.tsx`
  so `/admin/usage` and `/admin/system` do not repeat the same terminal table
  frame wrapper.
- Shared radar stats ownership through `lib/shell/radar-stats.ts`; shell pages,
  the radar widget, and DB dashboard stats now reuse the same `RadarStats`
  type plus empty fallback instead of repeating the four-field zero object.
- Aligned radar top-bar signal math with the 24h radar window: P1/featured
  counts now use the same window as `items_today`, and top-bar ratios are
  clamped to display-safe 0..1 bounds.
- Shared top-bar stats mapping through `lib/shell/top-bar-stats.ts`; pages now
  pass radar stats through one helper instead of hand-copying tracked-source
  counts and signal-ratio rules into every `ViewShell`.
- Shared shell chrome data loading through `lib/shell/chrome-data.ts`;
  `ViewShell` pages no longer repeat radar fallback, optional pulse loading,
  or top-bar stat mapping before rendering.
- Shared newest-first feed sorting through `sortStoriesNewestFirst` in
  `lib/feed/group-by-day.ts`; archive-style pages no longer hand-copy
  published-at descending comparators before UTC day grouping.
- Shared feed page query coercion through `lib/feed/page-query.ts`; home,
  all-posts, and curated routes no longer duplicate the date drilldown key,
  nonnegative offset parsing, or 500-row day drilldown limit.
- Shared feed empty-state styling through `components/feed/empty-state.tsx`;
  feed-like pages now keep their empty copy local but no longer duplicate the
  terminal centered empty-state treatment.
- Shared archive pagination through `components/feed/archive-pagination.tsx`;
  `/all` no longer owns local pagination markup, and `/curated` now exposes
  the offset pagination its query path already supported.
- Shared feed time display helpers through `lib/time/relative.ts`; feed rows
  and event-member drawers no longer carry untested local relative-time
  formatters.
- Kept translated relative-time tokens in `lib/time/relative.ts`; admin
  feedback rows no longer import a time helper from the generic `lib/utils.ts`
  class-name utility module.
- Derived usage dashboard window totals and admin range parsing from the shared
  `USAGE_WINDOWS` / usage-summary helpers; `/admin/usage` no longer depends on
  hand-written `today/week/month/all` totals or local query-param casts when the
  usage window contract changes.
- Shared `/admin/usage` provider/model label formatting through
  `lib/llm/usage-display.ts`, so task spend summaries and recent-call rows
  both identify the provider instead of showing ambiguous deployment names.
- Reused `APP_LOCALES` in `i18n/routing.ts`, so Next locale routing and
  API/OpenAPI/agent locale contracts no longer carry separate hard-coded
  `zh/en` tuples.
- Derived the login locale switcher options from `APP_LOCALES`, keeping the
  compact label mapping local while removing another route-locale enum copy.
- Shared locale pathname-prefix parsing through `appLocaleFromPathname` and
  `stripAppLocalePathPrefix`, so admin gating and shell nav active-state logic
  no longer carry separate `/zh|/en` regexes.
- Centralized mobile bottom-tab nav values in `NAV_MOBILE_TABS`, deriving route
  tabs from `NAV_PRIMARY` so desktop rail, mobile drawer, and mobile tab links
  cannot drift on core route hrefs.
- Shared shell nav href construction through `navHrefForLocale`, so desktop
  rail and mobile chrome no longer duplicate locale-prefix and `#` handling.
- Reused `APP_LOCALES` for tweak language options, so browser preferences and
  API tweak validation cannot drift from app route locales.
- Centralized `AppLocale` to BCP-47 language-tag mapping in
  `appLocaleLanguageTag`, so RSS rendering and saved-export date formatting no
  longer repeat `zh-CN` / `en-US` branches.
- Shared UI/admin date-format language tags through `appLocaleLanguageTag` /
  `AppLocaleLanguageTag`, so calendar, usage, version timeline, and iteration
  date formatting do not repeat `zh-CN` / `en-US` branches.
- Shared `sources.never_exclude` tier-floor handling through
  `workers/enrich/source-tier.ts`; live enrich and score-backfill now use the
  same source allow-list instead of a YouTube suffix heuristic.
- Derived main RSS feed ordering and locale coercion from `APP_LOCALES`, so RSS
  discovery metadata cannot drift from the app/API locale contract.
- Derived main RSS feed BCP-47 language tags from `appLocaleLanguageTag`, so
  channel metadata no longer repeats `zh-CN` / `en-US` next to the locale
  tuple.
- Shared admin mono blocks through `components/admin/mono-block.tsx`; policy
  error states and policy body previews no longer duplicate preformatted
  terminal panel styling.
- Shared admin monospace form controls through `components/admin/mono-field.tsx`;
  `PolicyEditor` now reuses common textarea/input styling while keeping its
  save, dirty-state, and confirmation behavior local.
- Reused `VISIBLE_ITEM_TIERS` in `/admin/system` queue SQL and enrich-worker
  retry priority SQL, so queue telemetry and re-enrich ordering cannot drift
  from the feed/commentary tier contract.
- Centralized fetch-cron cadence buckets in `workers/fetcher/pipeline.ts`;
  HTTP fetch routes and local `scripts/ops/run-cron.ts` now pass only the
  fetch-cron slug and cannot drift on `live/hourly/daily/weekly` membership.
- Updated README / `.env.example` / architecture docs so Tavily is not advertised as wired, cron docs match the current split route set, and cluster docs match the 0.75 / 72h runtime.
- Clarified the AI HOT documentation source of truth: root README and
  `docs/architecture/ingestion.md` now route current runtime behavior to the
  architecture doc, while `docs/aihot-integration/PLAN.md` is explicitly a
  shipped historical design record.
- Added archive banners to every `docs/aggregation/HANDOFF*.md` entry so
  direct readers see current clustering/cron/feed behavior is documented in
  `docs/architecture/ingestion.md`, not in older session handoffs.
- Archived `docs/aggregation/DESIGN.md` and `docs/aggregation/PLAN.md` in the
  same routing layer, so direct readers do not mistake the original
  event-aggregation spec/checklist for current implementation guidance.
- Standardized archive banners and source-contract coverage for
  `docs/aihot-integration/PLAN.md`, `docs/AGENT-MCP-PLAN.md`, and
  `docs/SESSION8-PUNCHLIST.md`, so old shipped plans and punchlists cannot be
  mistaken for current agent instructions.
- Standardized daily-column archive banners and source-contract coverage for
  `docs/daily-column/DESIGN.md`, `docs/daily-column/PLAN.md`, and
  `docs/daily-column/HANDOFF-2026-04-25.md`, replacing current-sounding launch
  handoff read-order language with historical routing.
- Aligned `docs/architecture/ingestion.md` with current runtime schema and
  policy lifecycle: scores/tags/policy hash live on `items`, policy content
  lives in `policy_versions.content`, iteration proposals live in
  `iteration_runs.proposed_content`, and policy changes only affect new or
  explicitly reset/backfilled enrich work.
- Aligned `/admin/system` queue telemetry with worker predicates: item commentary now counts only singleton/unclustered item candidates, event commentary is shown as its own queue, and the cron table derives schedules from `vercel.json`.
- Centralized `/admin/system` queue display metadata in
  `lib/shell/system-queues.ts`; queue names, order, throughput labels, and
  default latency/drift fields now have one tested source instead of inline
  objects inside `getSystemSnapshot`.
- Shared media/content URL ownership predicates through `lib/urls/media.ts`;
  article-body prefetch, YouTube transcript prefetch, enrich claim readiness,
  podcast embeds, and `/admin/system` queue depths now agree on which URLs
  need body prefetch and which X/Twitter rows can skip it before LLM spend.
- Capped scheduled event-level commentary to active 24h events via
  `EVENT_COMMENTARY_CRON_RECENCY_HOURS`; historical event-commentary backlog
  remains visible to operator scripts/backfills but no longer spends every
  cluster cron tick by default.
- Removed the separate `/admin/system` cron cadence path map; cadence labels
  are now inferred from the `vercel.json` cron expressions via
  `lib/shell/system-cron.ts`, so schedule parsing stays out of
  `getSystemSnapshot` and display cannot drift when a cron path changes.
- Shared `/api/admin/iterations/[id]` route-id parsing through `lib/policy/iterations.ts` so fetch/apply/reject stay behaviorally aligned.
- Shared protected-admin route auth, ok/error JSON envelopes, and catch-all
  server-error logging through `runAdminRoute(..., { serverErrorLabel })` in
  `lib/api/admin-route.ts`, wrapping the lower-level `lib/api/admin-auth.ts`
  auth/admin-required response mapping.
- Shared cookie-session route auth and ok/error JSON envelopes for
  required-session user routes (`/api/feedback*`, `/api/tweaks`), plus their
  domain-result mapping and catch-all server-error logging, through
  `runSessionRoute(..., { serverErrorLabel })` in `lib/api/session-route.ts`,
  wrapping the lower-level `lib/api/session-auth.ts` auth-required response.
- Shared the underlying `{ ok: true }` / `{ ok: false, error }` response
  envelope construction through `lib/api/ok-response.ts`; admin/session route
  helpers, auth-denial helpers, and admin login/logout cookie responses now
  reuse that implementation while keeping domain-specific names.
- Shared plain JSON success/error envelopes for small legacy/internal routes
  through `runPlainRoute(..., { serverErrorLabel })` in
  `lib/api/plain-response.ts`; `/api/events/:id/members` and
  `/api/sources/active` no longer hand-copy `Response.json` or catch-all
  `try/catch`/`console.error` server-error branches, and event-member domain
  failures map through `plainRouteResult`.
- Shared active source-picker payload lookup through
  `lib/api/source-catalog.ts`; `/api/sources/active` now keeps only the
  plain JSON/error envelope while the source-catalog helper owns the enabled
  source query, ordering, and compact `{ id, name, kind, group, locale }`
  serializer.
- Shared mutating route JSON body parsing and Zod error-envelope handling through `lib/api/json-body.ts`.
- Shared feedback vote values through `FEEDBACK_VOTES`, `FEEDBACK_SIGNAL_VOTES`,
  and `FEEDBACK_SAVE_VOTE` in `lib/types.ts`, so the DB enum, feedback request
  schema, admin metrics, and saved-item queries cannot drift on `up|down|save`.
- Shared admin session cookie set/clear options through
  `freshAdminSessionCookie` and `expiredAdminSessionCookie` in
  `lib/auth/password.ts`, so login/logout cannot drift on cookie name,
  `httpOnly`, `secure`, `sameSite`, path, or max-age attributes.
- Shared admin login/logout request and response construction through
  `lib/api/admin-session-routes.ts`, so login JSON parsing, password checks,
  next-target sanitization, invalid password envelopes, ok envelopes, and
  Set-Cookie attachment stay out of route leaf files while still using the
  common ok-response helpers.
- Shared admin policy commit request validation and `commitSkillVersion`
  mapping through `lib/api/policy-commit.ts`, so
  `/api/admin/policy/commit` keeps only admin auth, JSON parsing, and response
  mapping.
- Shared admin iteration-run lookup/apply/reject result semantics through
  `lib/api/iteration-routes.ts`, so `/api/admin/iterations/[id]` leaf routes
  keep only admin auth, route-id parsing, and response mapping instead of
  directly importing Drizzle, `iterationRuns`, status tuples, policy commits,
  or cache invalidation.
- Shared admin/v1 saved-collection CRUD result mapping through
  `lib/api/collection-routes.ts`, so both surfaces reuse the same
  `duplicate_name` and `not_found` decisions while keeping their own auth,
  request schemas, and response envelopes.
- Policy editor edit previews now reuse the shared `diffLines` +
  `DiffViewer` contract and register a dirty-draft `beforeunload` guard, so
  policy edits are reviewed against the committed baseline before publishing
  and tab-close protection is covered by a source contract test.
- Policy editor publish/discard confirmations now render inline in the admin
  surface instead of using browser-native `confirm()` dialogs. Covered by
  `tests/policy/policy-editor-source.test.ts`.
- Saved collection create/rename/delete and saved-item removal no longer use
  browser-native `prompt()` / `confirm()` flows. Collection mutations now stay
  in styled inline panels, and collection row action menus render in document
  flow instead of absolute dropdowns that can fall off short viewports.
- Shared saved-item request parsing through `lib/api/saved-requests.ts`;
  `/api/v1/saved` now delegates GET query extraction to
  `parseV1SavedQueryRequest`, while `/api/v1/saved` and
  `/api/feedback/move` reuse the same positive item id, positive collection id,
  inbox-null, locale, and pagination validation instead of carrying
  route-local Zod/query-parser wiring.
- Shared saved-item route payload semantics through `lib/api/saved-routes.ts`;
  `/api/v1/saved` now delegates saved lookup and agent serialization through
  `listSavedItemsRoutePayload`, `/api/feedback/move` delegates browser saved
  reparenting through `moveSavedItemRoutePayload`, and `/api/v1/saved` plus
  MCP `ax_radar_save` reuse the same save toggle, owner-aware collection
  assignment, assigned-collection response payload, and missing-item
  FK-to-`item_not_found` mapping.
- Shared browser saved-export parsing/rendering through
  `lib/api/saved-export.ts`; `/api/saved/export` now keeps only optional
  cookie-session fallback semantics while the helper owns collection/locale
  parsing, saved item and collection lookup, Markdown shape, deterministic
  filenames, and attachment headers.
- Saved export collection parsing now reuses
  `parseSavedCollectionParam` from `lib/items/saved-collection-selection.ts`,
  so browser export and `/saved` agree on `all`/`inbox`/numeric collection
  semantics and reject partial numeric strings such as `42abc`.
- Shared cookie/v1 tweaks persistence through `lib/api/tweak-routes.ts`, so
  user upsert, preferences/watchlist loading, DB patch construction, and
  `empty_body` decisions stay aligned while each route keeps its own auth and
  response envelope.
- Cookie-gated `/api/tweaks` now delegates shared persistence failures to
  `runSessionRoute(..., { serverErrorLabel })`, matching the other
  required-session routes instead of falling through to the framework's default
  500 response. Covered by `tests/api/tweaks-source.test.ts` and
  `tests/api/session-routes-source.test.ts`.
- Shared watchlist normalization through `lib/watchlist.ts`; browser right-rail
  add/remove flows and cookie/v1 tweak PATCH validation now trim, lowercase,
  and case-insensitively dedupe terms before persistence.
- Derived the site-config tweaks panel option values from the shared
  `TWEAK_*` runtime tuples in `lib/tweaks.ts`, so UI controls, API validation,
  defaults, and browser persistence no longer carry separate enum lists.
- Shared user roles and iteration statuses through `USER_ROLES`,
  `ITERATION_STATUSES`, and named status constants in `lib/types.ts`, so DB
  enums, auth upserts, iteration routes, agent runtime writes, and the admin
  iteration UI cannot drift.
- Shared LLM providers, usage task labels, and reasoning effort labels through
  `LLM_PROVIDERS`, `LLM_TASKS`, and `REASONING_EFFORTS` in
  `lib/llm/types.ts`; provider env parsing and usage ledger writes now validate
  against those runtime tuples before spending or recording cost.
- Shared newsletter kind and locale labels through `NEWSLETTER_KINDS` and
  `NEWSLETTER_LOCALES` in `lib/types.ts`; digest workers, daily-column queries,
  and backfill scripts no longer carry local `daily|monthly` / `zh|en` unions.
- Shared the daily-column writer locale through `DAILY_COLUMN_LOCALE`, so the
  daily writer, daily-column backfill, and AI HOT history importer cannot drift
  on which newsletter locale receives generated columns and payloads.
- Reused `DAILY_COLUMN_LOCALE` in the daily-column renderer, so detail-page
  date formatting, item links, and index links no longer hand-code the Chinese
  route locale.
- Shared daily-column public route construction through
  `lib/daily-column/routes.ts` exports (`DAILY_COLUMN_INDEX_ROUTE`,
  `dailyColumnIssueRoute`, and `dailyColumnItemRoute`), so the daily pages,
  renderer, RSS item links, and installable skill markdown no longer spell
  `/zh/daily` independently.
- Shared AI HOT history placeholder windowing through
  `dailyColumnWindowForDate`, so imported daily payload rows use the same 05:00Z
  period boundaries as the daily-column writer instead of creating midnight
  placeholder rows that would not conflict with the real cron upsert.
- Added `scripts/ops/repair-aihot-daily-windows.ts` as a dry-run-first repair
  path for legacy AI HOT placeholder rows. It only touches rows with no authored
  newsletter fields and `story_count=0`, then moves/merges them onto the same
  daily-column 05:00Z window helper.
- Reused `NEWSLETTER_LOCALES` in the legacy structured-newsletter RSS locale
  parser, so `/api/feed/newsletter/{locale}/rss.xml` cannot drift from the
  newsletter worker/API locale contract.
- Shared newsletter window calculations through `workers/newsletter/windows.ts`;
  daily digest, daily-column selection, monthly digest, and daily-column
  backfill scripts now reuse the same snapped UTC window and period-start
  replay helpers instead of repeating 24h/30d math locally.
- Shared positive route-id parsing through `lib/api/route-params.ts`; item
  detail, event-member, and admin iteration routes now reuse the same coercion
  and `invalid_id` error label.
- Shared REST/MCP search execution and payload serialization through
  `lib/api/search-results.ts`; adapters now own only
  auth/rate-limit/ETag/envelopes, while the helper owns lexical full-match
  totals, semantic source/date/tier filters, and public vs agent
  distance/latency/embedding metadata.
- Shared REST/MCP feed execution and payload serialization through
  `lib/api/feed-results.ts`; adapters now own only
  auth/rate-limit/ETag/envelopes, while the helper owns paired item +
  full-match total queries, pagination defaults, and public vs agent item
  exposure.
- Shared MCP feed/search tool input schemas and default-to-query mapping through
  `lib/api/feed-query-params.ts`; MCP `ax_radar_feed` and
  `ax_radar_search` now use the same source-filter/runtime tuple contracts as
  REST while route handlers stay thin execution/payload adapters.
- Shared feed query defaults and bounds through `lib/feed/query-defaults.ts`;
  REST query schemas, MCP feed mapping, feed execution envelopes, item lookup,
  and the generated OpenAPI feed docs no longer carry separate
  `featured/archive/40/0/24` defaults or `limit`/hot-window bounds.
- Shared search query defaults and bounds through `lib/search/query-defaults.ts`;
  REST search schemas, MCP search mapping, semantic result offsets, and generated
  OpenAPI search docs no longer carry separate `lexical/all/20/0/en` defaults
  or `limit` bounds.
- Shared item-detail lookup and bearer-agent payload construction through
  `lib/api/item-detail.ts`; public routes keep public cache/error mapping,
  while `/api/v1/items/:id` and MCP `ax_radar_get_item` share
  `getAgentItemDetailRoutePayload` and the full `toV1ItemDetail` serializer.
- Shared event-member route payload execution through
  `getEventMembersRoutePayload` / `getEventMembersPayload` in
  `lib/api/event-members.ts`; UI-internal, public, v1, and MCP adapters now
  own only their auth/rate-limit/cache/envelope mapping.
- Shared daily-column public lookup payloads and MCP markdown lookups through
  `lib/api/daily-columns.ts`; public daily route files now own only
  rate-limit/cache/error-envelope mapping, while MCP daily resources own only
  resource envelope mapping.
- Shared daily-column public query defaults and bounds through
  `lib/daily-column/query-defaults.ts`; the daily-column API parser,
  generated OpenAPI spec, installable skill markdown, and public dailies route
  comments no longer repeat the `take` range/default or locale default.
- Shared bearer-agent usage summary request parsing and serialization through
  `lib/api/usage-summary.ts`; `/api/v1/usage/summary` and MCP
  `ax_radar_usage` now share the window schema/default plus the same totals,
  `by_task`, `by_model`, and `recent_calls` contract.
- Shared usage window keys through `USAGE_WINDOWS` in `lib/llm/stats.ts`, so
  the admin usage page, v1 usage summary, and MCP usage tool cannot drift on
  the `today|week|month|all` window set or its default `week` behavior.
- Shared admin usage presentation helpers through `lib/llm/usage-display.ts`,
  so range labels, task badge tones, token/call compaction, sparkline dates,
  and task-model summaries stay exhaustive over `USAGE_WINDOWS` and
  `LLM_TASKS` instead of living as page-local switches.
- Shared source kind/group/cadence/source-locale/source-health status runtime tuples through `lib/types.ts` and
  source group display metadata through `lib/sources/groups.ts`, so DB enums
  and the `/sources` group order/labels cannot drift from catalog types.
- Reconciled `scripts/ops/seed-sources.ts` with `lib/sources/catalog.ts` as the
  source of truth: seed now upserts catalog rows and disables enabled DB-only
  orphan source rows, preventing removed sources from staying visible as
  cron-pending work.
- Shared app/source locale tuples and the fetcher-supported source-kind subset
  through `lib/types.ts`, so DB locale enums, REST/MCP locale schemas, sitemap
  locales, and fetcher support checks cannot drift.
- Centralized route-locale defaults and param normalization through
  `DEFAULT_APP_LOCALE`, `isAppLocale`, and `appLocaleFromParam` in
  `lib/types.ts`; feed-like locale pages now normalize once and pass
  `AppLocale` through instead of repeating route-local `locale as "zh" | "en"`
  casts.
- Extended normalized route-locale handling to the remaining locale page
  leaves: admin, agents, sources, daily, login, and podcast detail pages now
  call `appLocaleFromParam` once and pass `AppLocale` through local data
  loading, links, and shell components.
- Replaced component-local `"en" | "zh"` locale prop aliases with shared
  `AppLocale` across shell, feed, saved, X-monitor, admin timeline, agent
  tabs, and tweak-provider UI boundaries.
- Replaced library-local locale unions and aliases with `AppLocale` across
  saved-item queries, public/v1 item serializers, relative-time formatting,
  feedback metrics, ticker loading, usage labels, admin-gate locale parsing,
  and agent iteration prompts.
- Shared item tier, feed view, search mode, and source filter runtime tuples through
  `lib/types.ts`, so REST feed/search schemas, MCP feed/search input schemas,
  item/event commentary workers, score prompt parsing, and source filtering
  cannot drift on `featured|p1|all|excluded`, `today|archive`,
  `lexical|semantic`,
  `source_group`, or `source_kind`.
- Shared the `featured|p1` highlight/deep-dive tier subset through
  `HIGHLIGHT_ITEM_TIERS` and `isHighlightItemTier` in `lib/types.ts`, so
  feed serializers, item/event commentary dispatch, treatment routing, and
  operator backfill scripts no longer repeat that decision locally.
- Shared highlight-tier SQL predicates through `lib/items/tier-sql.ts`, so
  feed/calendar counts, ticker selection, diagnostics, and feedback fixtures
  reuse the same `HIGHLIGHT_ITEM_TIERS` tuple instead of hand-writing
  equivalent two-value `IN` or `OR` clauses.
- Shared home feed tier/view defaults through `lib/feed/home-filters.ts`, so
  the server query parser, home filter UI, all-posts source filter reuse, and
  calendar count filter cannot drift on `featured|p1` or `today|daily`.
- Shared home/all source preset defaults, labels, coercion, and feed-query
  mapping through `lib/feed/source-presets.ts`, so page parsers and
  `HomeFilters` no longer carry app-local `all|official|newsletter|media|x|research`
  lists.
- Shared podcast feed tier defaults/coercion through
  `lib/feed/podcast-filters.ts`, so `/podcasts` no longer carries a local
  `featured|all` tier union or query parser.
- Shared source-catalog view defaults/coercion through `lib/sources/view.ts`,
  so `/sources` and its view toggle cannot drift on `table|cards` or default
  URL behavior.
- Shared public/agent API item source-field types and cluster lead-pick source
  authority types through `SourceGroup` / `SourceKind` from `lib/types.ts`;
  the archived s9 MCP plan is now labeled historical so old enum examples
  are not mistaken for current implementation guidance.
- Shared `/skill.md` and `/openapi.yaml` public contract enums through the same
  `lib/types.ts` runtime tuples, including app/source locales, source
  group/kind/cadence, source-health statuses, item tiers, feed views, and search modes; the source catalog
  description no longer embeds a stale monitored-source count, and MCP
  source-tool copy avoids fixed counts for the same reason.
- Shared public API endpoint metadata through
  `lib/api/public-endpoint-config.ts`, with public route HTTP envelopes
  centralized in `lib/api/public-helpers.ts`; public route handlers now enter
  through `publicCachedRoute(req, { endpoint, etagFamily, label, load })`, while
  `/skill.md`, `/openapi.yaml`, `/agents`, and
  `docs/agent-access/README.md` render or verify the same endpoint count,
  limit labels, and cache policy instead of repeating budgets or 304 wiring.
- Shared public 4xx/5xx envelope mapping through `publicCachedRoute` in
  `lib/api/public-helpers.ts`; anonymous public route files keep domain
  validation/404 decisions local as `{ ok: false, error, status }` results but
  no longer hand-copy rate limits, cache/ETag responses, `publicError`, or
  `console.error` plus `server_error` catch blocks.
- Shared REST query-param extraction and validation plumbing through
  `lib/api/query-params.ts`; public and v1 query routes now reuse one
  Request/URLSearchParams parser while keeping their separate
  `publicInvalidQueryResult` and `v1InvalidQueryResult` envelope adapters.
- Shared public domain-result to cached-route-result mapping through
  `publicRouteResult`; public daily and event-member routes now keep only
  success body/ETag-signal shaping while the public helper maps
  `{ ok: false, error, status }` branches.
- Shared v1 server-error logging/envelope through `runV1Route(..., {
  serverErrorLabel })` in `lib/api/v1-route.ts`; v1 route files keep their
  business 4xx branches but no longer hand-copy `try/catch`, `console.error`,
  or `v1Error("server_error", 500)`.
- Shared admin/v1 domain-result envelope mapping through `adminRouteResult`
  and `v1RouteResult`; collection, saved, event-member, and tweak leaf routes
  now keep only success payload shaping while the surface helpers map
  `{ ok: false, error, status }` branches.
- Shared route payload result types through `lib/api/route-result.ts`; admin,
  session, v1, plain, and public helpers now alias the same ok/error contract
  instead of repeating local `{ ok, payload/error/status }` unions.
- Shared required-session domain-result envelope mapping through
  `sessionRouteResult`; `/api/tweaks` and `/api/feedback/move` now keep only
  success payload shaping while the session helper maps `{ ok: false, error,
  status }` branches.
- Shared plain domain-result envelope mapping through `plainRouteResult`;
  `/api/events/:id/members` now keeps only success payload shaping while the
  plain-response helper maps `{ ok: false, error, status }` branches and
  `runPlainRoute(..., { serverErrorLabel })` owns catch-all server errors.
- Shared admin iteration route adapters through `lib/api/iteration-routes.ts`;
  `/api/admin/iterations/run` now keeps only the route config and
  `runAdminIterationStartRoute`, while `/api/admin/iterations/[id]`, `/apply`,
  and `/reject` keep only the action binding and `serverErrorLabel`. The
  shared helper owns admin auth, route-id parsing, agent-run guard errors,
  catch-all server-error logging, and `adminRouteResult` envelope mapping.
- Shared RSS XML/HTTP response envelope, XML escaping, CDATA splitting, and
  lightweight markdown-to-HTML rendering through `lib/rss/render.ts`;
  `/api/rss/*`, the featured-locale feeds, and the legacy newsletter feeds now
  use the same renderer/response helper while keeping feed-specific metadata
  such as radar extension fields.
- Shared main locale RSS metadata through `lib/rss/main-feed-meta.ts`; the
  featured-locale RSS route, layout alternate links, home RSS button, and
  `/agents` integration cards now reuse one locale/path/title contract.
- Shared main `/api/feed/{locale}/rss.xml` feed construction through
  `lib/rss/main-feed.ts`; the route now owns only locale coercion and the RSS
  HTTP response envelope, matching the legacy and newsletter RSS route shape.
- Shared legacy `/api/rss/{daily,today,curated}.xml` feed construction through
  `lib/rss/legacy-feeds.ts`; the slug route now owns only rate-limit, slug
  validation, 404 handling, and the RSS HTTP response envelope.
- Shared legacy RSS slug metadata through `lib/rss/legacy-feed-meta.ts`; the
  RSS renderer and `/agents` integration page now reuse one slug/path/title
  contract instead of separately hand-writing `/api/rss/*.xml` cards.
- Shared legacy structured newsletter RSS construction through
  `lib/rss/newsletter-feed.ts`; `/api/feed/newsletter/{locale}/rss.xml` now
  owns only locale normalization and the RSS HTTP response envelope.
- Overlaid `/admin/system` cron rows with DB-derived recent activity in
  `lib/shell/system-cron.ts` / `lib/shell/system-stats.ts`; schedules still
  come from `vercel.json`, while jobs without a durable timestamp explicitly
  show `no signal`.
- Shared relative-time display helpers through `lib/time/relative.ts`;
  system cron rows, system source-health notes, daily index rows, and policy
  summary labels now reuse the same date coercion / latest-date / compact-age
  helpers instead of carrying local `ago` variants.
- Shared item tag flattening through `lib/items/tags.ts`; live feed, saved
  stories, item detail, and semantic-search mappers now reuse the same
  capability/entity/topic ordering while keeping their own display caps.
- Shared item locale fallback helpers through `lib/items/localized.ts`; Story
  mappers now reuse the same zh/en/legacy fallback rules for titles,
  summaries, editorial text, source labels, and score reasoning instead of
  hand-writing locale ternaries in each surface.
- Shared Story row mapping through `lib/items/story-mapper.ts`; live feed,
  saved stories, item detail, and semantic-search now keep SQL/query ownership
  local while reusing one tested mapper for source labels, tags, locale
  fallbacks, effective event fields, HKR, coverage, and still-developing state.
- Shared Story DB select aliases through `lib/items/story-select.ts`; those
  same Story surfaces now reuse one item/source field set and one event field
  set instead of copying column aliases into each query.
- Shared admin usage dashboard aggregation through
  `lib/api/usage-summary.ts`; `/admin/usage`, `/api/v1/usage/summary`, and
  MCP usage now all enter through the same summary boundary instead of the
  page importing low-level LLM stat queries directly.
- Shared bearer-gated `/api/v1/*` auth, catch-all server-error handling, and
  plain JSON/error envelopes through `lib/api/v1-route.ts`; v1 route files now
  call `runV1Route` with `serverErrorLabel` and return `v1Json` /
  `v1RouteResult` / `v1InvalidQueryResult`, so token verification, query
  validation envelopes, domain-result failures, and response shape cannot drift
  between agent endpoints.
- Shared agent bearer auth through `lib/auth/api-token.ts` for both
  `/api/v1/*` and `/api/mcp`; v1 routes enter via `runV1Route`, while MCP
  calls `requireApiToken` directly before handing control to the Streamable
  HTTP transport.
- Shared hourly/daily/weekly fetch+normalize sequencing through `workers/fetcher/pipeline.ts`, with HTTP route wiring in `app/api/cron/_fetch-bucket-route.ts` and local cron scripts using the same helper.
- Shared cron HTTP auth/timestamp/JSON envelopes through
  `app/api/cron/_route.ts`, so cron leaf route files only declare static Next
  route config and map worker reports into response payloads.
- Shared article body + YouTube transcript prefetch sequencing through
  `workers/fetcher/content-prefetch.ts`, so `/api/cron/article-body` and
  `bun scripts/ops/run-cron.ts body` use the same production path.
- Shared article-body / YouTube / X-status URL predicates through
  `lib/urls/media.ts`; content-prefetch workers, enrich claim readiness, the
  podcast embed parser, and `/admin/system` body/enrich queue depths now use
  the same source of truth instead of repeating URL `LIKE` patterns.
- Table-drove `scripts/ops/run-cron.ts` through one `CRON_RUNNERS` map and
  exposed all production cron route slugs as `bun run cron:<bucket>` aliases,
  including `fetch-*`, `article-body`, `commentary`, `score-backfill`,
  `cluster`, and newsletter cron tasks; short aliases such as `hourly`,
  `body`, `score`, and `yt` remain available for operators.
- Added an enrich claim readiness gate: normal web items must have
  `body_fetched_at` set before `runEnrichBatch` can claim them, while
  X/Twitter status URLs remain exempt because their adapter already stores
  full tweet text. This prevents the `fetch-hourly :17` / `enrich :20`
  cron ordering from spending LLM tokens before article-body has a chance
  to run.
- Shared enrich-claim reset values through `workers/enrich/claim-state.ts`;
  worker success and operator reset scripts now clear `enrich_claimed_at`,
  `enrich_attempts`, and `enrich_error` from one helper instead of repeating
  the three-field reset object.
- Shared the full cluster Stage A/A.5/B/B+/C/D sequence through `workers/cluster/pipeline.ts`, so `/api/cron/cluster` and `bun scripts/ops/run-cron.ts cluster` no longer drift.
- Stopped a cluster-cron arbitration loop: Stage A and singleton-recluster now
  skip clusters already rejected for the item in `cluster_splits`, preventing
  the same fuzzy join from being re-added and re-split every tick; after three
  distinct rejected clusters, Stage A explicitly settles the item as a
  singleton before running nearest-neighbor probes.
- Added the shared visible-tier SQL gate to cluster Stage A and
  singleton-recluster: `tier='excluded'` rows are no longer clustering
  candidates or neighbors, so recurring low-value items cannot trigger
  arbitration/canonical-title/event-commentary spend. A production preflight
  on 2026-06-19 showed the live Stage A queue would drop from 2 old candidates
  to 0 under the new predicate.
- Moved render-local helper components out of `components/shell/tweaks.tsx`.
- Reworked effect async loading in `SignalDrawer` and `TweaksProvider` to satisfy React lint rules without disabling them.
- Replaced an internal raw `<a>` with locale-aware `next/link`.
- Removed unused imports/locals across app, tests, scripts, and workers.
- Updated stale prompt tests to match the current friend-readable daily-column voice.
- Added `docs/README.md` routing and archive banners for completed daily-column design/plan/handoff docs.
- Updated `docs/reports/code-quality/dead-code-analysis.md` with current Knip commands, cleanup results, and remaining type-review queue.

Verification (2026-06-13):
- `bun run code:dead` — passed.
- `bun run code:dead:exports` — passed.
- `bun run code:dead:types` — passed.
- `bun run lint` — passed with no warnings.
- `bun test --env-file=.env.local` — 786 pass, 1 skip, 0 fail.
- `bun run build` — passed.
- `git diff --check` — passed.

## 2026-06-11 — Enrich spend guardrails, usage all-time/model labels

Current production direction:
- `/admin/usage`, `/api/v1/usage/summary`, and MCP `ax_radar_usage` report `today`, `week`, `month`, and `all` windows.
- Task spend rows include per-model/provider breakdowns; recent calls show provider/model labels.
- Enrich workers must claim rows before LLM calls. Do not reintroduce plain `WHERE enriched_at IS NULL LIMIT n` worker selection for spend-bearing work.

Incident root cause:
- Backfill plus the 15-minute enrich cron left overlapping workers selecting the same `enriched_at IS NULL` rows. The final `UPDATE ... WHERE enriched_at IS NULL` kept storage idempotent, but duplicate workers still paid for repeated `score`, `enrich`, and `embed` calls.
- Stuck rows amplified the issue: DeepSeek schema overflows and a local Azure embedding API-version drift caused retry loops before rows could become enriched.

Shipped code changes:
- Added `items.enrich_claimed_at`, `items.enrich_attempts`, and `items.enrich_error` plus a manual migration.
- `runEnrichBatch` now uses `FOR UPDATE SKIP LOCKED`, stale-claim retry, max attempts, failure recording, and lower default per-tick caps.
- Prompt schemas now truncate/cap overlong arrays and rationale strings instead of failing after successful model output.
- Azure embedding API version is normalized when env accidentally contains `v1`; LLM generate/embed calls have a default 90s timeout.
- Usage admin/API/MCP gained all-time totals, model breakdowns, and recent-call model labels.

Verification:
- Manual DB migration applied to production database and columns verified.
- Focused test suite for enrich claim locking, prompt schema tolerance, usage stats, DeepSeek routing, cron split, and daily-column tests passed.
- `bun run build` passed.
- Targeted ESLint over touched files and `git diff --check` passed.
- Full `bun run lint` still has unrelated pre-existing failures outside this change set.

## 2026-06-10 — DeepSeek treatment rebase, paper retirement, cluster cleanup

Current production direction:
- Prose/scoring defaults moved off GPT-5.5 and onto Azure AI Foundry DeepSeek.
- High-value enrich/commentary/cluster/daily work uses `DeepSeek-V4-Pro`.
- Low-value item treatment and cheap arbitration use `DeepSeek-V4-Flash`.
- Azure OpenAI remains active for `text-embedding-3-large` embeddings and the `gpt-5.5-standard` compatibility/probe deployment.
- The desired editorial voice is "send this to a smart friend": plain, specific, accurate, low translationese, and not memo/jargon-heavy.
- Paper-only sources are retired. Do not re-add arXiv, Hugging Face Papers, Papers with Code, `hf-papers-takara`, `/papers`, `papers.xml`, or `ax-radar://papers`.

Shipped code changes:
- Added `azure-deepseek` provider support in `lib/llm/index.ts`, including Azure Responses-style endpoint normalization, structured JSON parsing, schema retry, and Flash-to-Pro fallback.
- Added treatment routing in `workers/enrich/treatment.ts`; enrich/score/commentary/cluster paths now choose Pro vs Flash by item importance/tier.
- Rewrote Chinese and daily prompts toward friend-sharing language in `workers/enrich/chinese.ts`, `workers/enrich/prompt.ts`, `workers/cluster/prompt.ts`, and `lib/llm/prompts/daily-column.md`.
- Removed paper surfaces from catalog, navigation, sitemap, RSS, MCP, public skill, OpenAPI, and `/papers`.
- Added `scripts/ops/cleanup-paper-sources.ts`, `scripts/ops/backfill-chinese.ts`, and `scripts/ops/backfill-daily-columns.ts`.
- Added singleton reclustering so recent singleton items get another chance to join existing events before duplicate-cluster merge.
- Centralized the canonical public origin in `lib/site.ts` so sitemap, robots, RSS, `/skill.md`, `/openapi.yaml`, and `/agents` share `https://news.ax0x.ai` instead of mixing the production domain with the Vercel alias.

Backfill/DB state verified on 2026-06-10:
- Chinese backfill state: `enrich=14909`, `score=14909`, `commentary=6774`, `clusters=1660`.
- Daily-column backfill: 51 historical daily rows regenerated and self-check-clean.
- Paper cleanup: explicit retired paper sources and arXiv/paper-tagged source rows count `0` in DB after cleanup.
- Empty clusters count `0`.

Verification already run:
- `bun test --env-file=.env.local tests/cluster/singletons.test.ts tests/cluster/merge.test.ts workers/cluster/arbitrate.test.ts tests/llm/deepseek-routing.test.ts tests/enrich/treatment.test.ts tests/enrich/friendly-style.test.ts` — 59 pass.
- Earlier focused suite — 148 pass.
- `bun run build` — passed, route list has no `/papers`.
- Dry runs after backfill: `backfill-style`, `backfill-chinese`, `backfill-daily-columns`, and `cleanup-paper-sources` all returned zero pending targets.

Typecheck gate:
- `bun run typecheck` now passes and covers tests plus Bun runtime APIs. Keep
  this gate green alongside `next build`; do not reintroduce fixture drift that
  only `bun test` happens to tolerate at runtime.

---

# Archived Notes — Session Handoff (2026-04-19/20, Session 8 complete)

> Read this first before resuming. Prior sessions: s1-3 = M0-M2 + RSS/commentary/newsletter/i18n/HKR/bilingual; s4 = Jina body fetch + 晚点 prompts + YT transcripts + `/podcasts`; s5 = M3 auth+feedback+admin-gate + podcast detail + CRON_SECRET; s6 = M4 editorial agent + X ingestion + password gate + 20 broken sources disabled; **s7** = 2026 backfill (+2907 items) + full terminal-aesthetic port of 12 views + named saved-collections + server tweaks sync + 12/14 design-mock divergences closed. **s8 (this one)** = bug triage + admin rebuild + pagination/calendar + YouTube full-coverage pipeline + cleanup of 15 dead sources. Shipped **9 commits** on main (no PR branching this session).

> ### ⭐ Session 9 primary goal: **expose the radar to agents via HTTP API + MCP**
>
> Historical note: at the end of s8, the next planned work was to expose the
> radar to tool-using agents. That plan shipped and is now archived at
> [`docs/AGENT-MCP-PLAN.md`](./AGENT-MCP-PLAN.md). Current agent/API/MCP
> behavior and contributor guidance live in
> [`docs/agent-access/README.md`](./agent-access/README.md).

---

## TL;DR — where the project is at end of session 8

- **Live**: https://news.ax0x.ai
- **Repo**: https://github.com/xingfanxia/newsroom — s8 shipped **9 commits** directly on `main` (no PRs this session; tight iteration with user bug reports). `d350caa → d0b3e17`.
- **Aesthetic**: terminal-forward with HKR ring, accent-green, JetBrains Mono + Noto Sans SC. Admin pages now all match the demo.
- **Auth**: still password-gated via `ADMIN_PASSWORD` env.
- **Data state (end s8)**:
  - **items**: **6821 total · 6803 enriched (99.7%)** · 1337 curated · 2900 with commentary · 5297 with body_md
  - **sources**: **59 total, 43 enabled** (13 fully removed + 2 disabled this session)
  - **feedback**: 10 rows (fixture)
  - **saved_collections**: 0 (nobody used it yet)
  - **policy_versions**: 1 · iteration_runs: 0 (M4 agent still never run through prod UI)
  - **30-day LLM spend**: $443.25 across 68k calls

### Content flow is healthy

- Enrich pipeline caught up: 99.7% enriched (up from 83% at s7 end).
- Commentary pipeline caught up: 2900 items have deep notes (up from 1967).
- YT channels: 110 items, **0 excluded**, 86/110 have full transcripts (see below).

---

## Session 8 shipped

### Round 1 — `d350caa` — data/feed bugs from user's screenshot triage

- **Radar stats showed all 0s** — root cause: drizzle drops the `items.`
  table prefix when a `Date` param is bound, `postgres-js` then rejects
  the ambiguous statement. Fixed with explicit `::timestamptz` casts in
  `getRadarStats`, `getTopTopics`, and `getFeaturedStories` date filter.
  Widget now reports non-zero today / P1 / featured / source metrics again.
- **Radar sweep static + bottom clipping** — SVG `viewBox` expanded to
  `-8 -8 116 116` so HOOK/AUTH/RES/DENSITY labels don't clip. Later bug
  in the same widget (see round 5 below) with the transform origin.
- **Save button inert** — wired to `/api/feedback` with optimistic
  toggle + rollback on 401/fail. Renders `✓ 已收藏` in green when active.
- **Shallow commentary** — `editor_note || editor_analysis` was hiding
  the multi-para analysis behind the one-liner. Now renders both in the
  expand panel as "编辑点评" + "深度解读". Saved-export MD also picks up
  `editor_analysis` + reasoning.
- **Watchlist placeholders** — `DEMO_WATCHLIST` (gpt-6, 盘盘猫 etc.)
  removed; empty state + inline add CTA instead.
- **Home 40 cap / /all 80 cap** — `/all` bumped 80 → 120 default, 500
  when a day is active; also added day-filter URL param.

### Round 2 — `6ae8bf9` — admin pages rebuilt + errored-source cleanup

- **`/admin/usage`** fully rebuilt per `Admin - Usage.html` demo:
  cost-big hero + monthly cap (default $1000 via env) + 30d daily-spend
  SVG sparkline + token-mix hbar tiles + cost-by-task table with share
  bars + cost-by-model table + 25 most recent calls. Range switcher
  via `?range=today|week|month|all` (server-rendered, no client JS needed).
- **`/admin/system`** rebuilt per `Admin - System.html` demo: 4 hero
  tiles (services up / queue depth / errors 24h / cron jobs) + warn
  banner when any enabled source is erroring + services grid from
  `source_health` + queues table (normalize/enrich/commentary/score
  depths) + cron table mirrored from `vercel.json` + 24h error log
  joined from `source_health.last_error`. Spend tables moved out.
- **Terminal CSS ported from demo view.css**: `.tiles/.tile`, `.dt`
  data tables with sticky headers + color variants, `.sd` status dots,
  `.cost-big` split currency, `.progress`, `.hbar`, `.svc-grid`,
  `.svc-card`, `.banner.warn/.info`, `.row-act`, `.mini-btn`. These
  were silently missing which is why admin pages looked wrong.
- **15 errored sources removed**: 13 zero-item (`zhihu-hotlist`,
  `github-trending`, `huxiu-ai`, `jiqizhixin`, `qbitai`,
  `wechat-jiqizhixin-mp`, `sspai-matrix`, `36kr-ai`, `google-deepmind`,
  `xiaomi-research`, `meta-ai`, `thebatch`, `rest-of-world`) fully
  deleted. 2 with items (`36kr-direct` 220 items, `sspai-direct` 99
  items) disabled but preserved. Catalog at `lib/sources/catalog.ts`
  went 71 → 56 entries.

### Round 3 — `d0735c3` — calendar grid + home limit bump

- **New CalendarGrid component** (`components/feed/calendar-grid.tsx`):
  month-view 7-col × N-row grid with activity-scaled accent-green
  cells. Click a day → `?date=YYYY-MM-DD`. Mon-first week order for
  zh convention. Replaces the horizontal DayPicker strip on home + /all.
- **Home limit 40 → 120** default (500 when day is picked). Featured
  page was showing 1/25 of the 981 featured items after the backfill.

### Round 4 — `8c8658a` — healthy classification, monthly cap, calendar polish, pagination

- **Services hero reads 42/43 healthy** not 9/43. Old rule required a
  successful fetch within 2h which mis-flagged every daily + weekly
  source as idle. New rule: cadence-agnostic — healthy = has a
  lastSuccessAt + zero consecutive failures.
- **Monthly cap default 500 → 1000 USD**. Still `USAGE_MONTHLY_CAP_USD`
  env-overridable.
- **Calendar month order** flipped to chronological (prior month left,
  current right).
- **Active calendar cell toggles** — clicking the highlighted day
  clears the `?date=` filter instead of re-navigating.
- **/all paginated**: `?offset=N` driven, `PAGE_SIZE=200`, footer nav
  with `← newer / older →` links. Day-filtered view stays uncapped.

### Round 5 — `6a24167` — daybreak two-dates bug

- `DayBreak` was rendering `2026-04-17 · 星期四  2026年4月16日` for items
  published around UTC midnight. Root cause: ISO half used
  `toISOString()` (UTC) while the CJK half used
  `getFullYear()/getMonth()/getDate()` (local). Rebuilt both from local
  components to match `groupByDay`'s bucket. Also dropped the redundant
  CJK span when EN is selected (bilingual duplication).

### Round 6 — `7030e2d` — /podcasts featured↔all tier toggle

- New tier pill row under the channel pills on `/podcasts`:
  `featured` (curated) vs `all` (includes tier=excluded). URL-state via
  `?tier=all` alongside `?source=<id>`. Limit bumped to 120
  (all-channels) / 300 (per-channel).

### Round 7 — `faff987` — YouTube never excluded

- Hand-picked YT channels (dwarkesh, bestpartners, lex-fridman,
  thevalley101) are interesting in their off-topic episodes too.
  Floor scorer's tier at `'all'` for `source_id LIKE '%-yt'` — low
  importance still sorts below curated AI content but nothing gets
  hidden. Patched both `workers/enrich/index.ts enrichOne()` and
  `workers/enrich/score-backfill.ts`. One-shot DB migration upgraded
  77 previously-excluded YT items. Result: **0 excluded YT items**
  across all 4 channels.

**YT pipeline state end s8**: 110 items total, 106 enriched, 22
featured/p1, 83 in `all` tier, 86/110 with full transcripts (the
remaining 24 split ~12 truly captions-disabled + ~12 thevalley101 auto-
generated zh captions the `youtube-transcript` lib can't parse).
Commentary: 106/106 enriched items have deep notes.

### Round 8 — `d0b3e17` — right-rail layout + sweep origin

- Three bugs same root cause: `.rail-r` is a flex column with
  `height: calc(100vh - 40px)`, panels defaulted to `flex-shrink: 1`,
  and `.panel { overflow: hidden }` (needed for border-radius) chopped
  whatever couldn't fit. Fixed with `.panel { flex-shrink: 0 }` so
  panels keep natural height and the rail's own `overflow-y: auto`
  handles scroll.
- Radar sweep was rotating around the wedge-path's own bounding-box
  center (~67, 28) instead of the radar center (50, 50) because
  `transform-box: fill-box` uses the element's fill-box, not the SVG
  viewBox. Swapped to `transform-origin: 50px 50px` (explicit SVG user
  units).
- Topics cloud capped at 320px internal scroll so it doesn't push
  curation-policy off the rail.

---

## Critical gotchas carried into session 9

1. **Drizzle drops table prefix on Date params** — `items.createdAt >= $1`
   gets SQL-ified as `"created_at" >= $1` (no table qualifier) and
   postgres-js rejects the ambiguous statement. **Always cast Date
   params to `::timestamptz` inline** when mixing with column refs:
   ```ts
   sql`${items.createdAt} >= ${isoString}::timestamptz`
   ```
   Not:
   ```ts
   sql`${items.createdAt} >= ${dateObj}`  // silently fails in prod
   ```
2. **Drizzle-kit push drops HNSW index** because `halfvec_cosine_ops`
   isn't known to drizzle. Always run `bun run db:hnsw` after
   `bun run db:push`. **Still relevant for s9 semantic search work.**
3. **`--font-mono` needs `Noto Sans SC`** in the fallback stack so CJK
   glyphs don't fall back to OS-specific faces.
4. **Resolved 2026-06-12: `getFeaturedStories` has server-side source filters** —
   current callers use `sourceId`, `sourceGroup`, and `sourceKind`; the old
   client-side publisher-name workaround is not current guidance.
5. **M4 agent still must use `reasoningEffort: "medium"`** on Azure
   Pro — xhigh/high hit 5-min ceiling on 12KB prompts.
6. **Tweaks localStorage migration** — legacy `"both"` language auto-
   normalises to `"en"`. Removed from UI in s6.
7. **Password rotation invalidates cookies** — `ADMIN_PASSWORD` is the
   HMAC key. Feature, not bug.
8. **rsshub.app is dead** — all 8 rsshub sources still disabled.
9. **Commentary `maxTokens = 6144`** + the `<before>/<after>` block in
   `workers/enrich/prompt.ts` is load-bearing.
10. **Vercel env baked at deploy time** — `vercel env add` alone
    doesn't take effect; empty commit + push triggers rebuild.
11. **X billing discipline** — `since_id` cursor on
    `source_health.lastExternalId` keeps steady-state near zero.
    Historical backfills bill per tweet.
12. **Never-exclude tier floor** — `sources.never_exclude=true` + scorer
    `excluded` gets silently upgraded to `'all'` through
    `workers/enrich/source-tier.ts` in both live enrich and
    `runScoreBackfill`. Don't remove without asking operator.

---

## Historical Session 9 priorities (superseded)

### 1. Agent/MCP exposure — shipped
Do not treat this checklist as current work. Current agent/API/MCP behavior
lives in [`docs/agent-access/README.md`](./agent-access/README.md); the
original session-9 design record is archived at
[`docs/AGENT-MCP-PLAN.md`](./AGENT-MCP-PLAN.md).

Original phase outline:
1. HTTP API v1 (read): `/api/v1/feed`, `/api/v1/items/[id]`,
   `/api/v1/sources`, lexical `/api/v1/search`. Bearer auth via new
   `api_tokens` table.
2. HTTP API v1 (write): `/api/v1/saved`, `/api/v1/collections/*`,
   `/api/v1/watchlist`.
3. Semantic search: extend `/api/v1/search?mode=semantic` using
   existing pgvector HNSW on `items.embedding`.
4. MCP server at `/api/mcp` via `@modelcontextprotocol/sdk` Streamable HTTP —
   thin wrapper around shared agent helpers.
5. Claude Code skill at `~/.claude/skills/ax-radar/SKILL.md` with
   domain glossary (tier/HKR/importance semantics).

Historical pre-flight now resolved: `getFeaturedStories` supports per-source
filters, and `/api/v1/feed?source_id=<id>` does not rely on publisher-string
matching.

### 2. M4 agent end-to-end UAT
Still never exercised through prod UI. First iteration remains
available in `/admin/iterations`. Worth running once in s9 to verify
the agent still works post-backfill.

### 3. Key rotation (5+ sessions overdue)
OpenAI/Anthropic/Gemini/Azure/Jina keys have been in chat history
since s3-4. 10 min per provider. Operator hasn't prioritized but it's
sitting.

### 4. Mobile viewport QA
`.m-tabbar` + `.m-drawer` + 720px breakpoint CSS is wired but never
browser-verified. Open DevTools responsive mode + walk through `/`,
`/saved`, `/sources`, `/admin/iterations`.

### Deferred
- **#9 low-follower viral** — feature deferred; the route has been deleted.
  Do not recreate it until source APIs make follower/impression data
  affordable and the product decision is revisited.
- **Tweaks PATCH floods** — rapid theme/accent scrubbing fires 10+
  PATCH requests in a second. Add 500ms debounce.
- **`/admin/users`** still `ComingSoonPanel` — single-user mode so low
  priority until multi-user.

---

## Key files the s9 work will touch

- `db/schema.ts` — add `api_tokens` table (id, user_id, token_hash,
  label, last_used_at, created_at, revoked_at)
- `lib/auth/api-token.ts` — shared bearer-token verifier for `/api/v1/*`
  and `/api/mcp`; use `requireApiToken(req)`
- `app/api/v1/` — new route namespace
- `app/api/mcp/route.ts` — MCP Streamable HTTP endpoint
- `lib/items/live.ts` — add `sourceId` to `FeedQuery`, drop the
  client-side publisher-string workaround on podcasts + x-monitor
- `scripts/ops/mint-api-token.ts` — CLI to issue tokens

---

## Pre-flight for session 9

```bash
cd ~/projects/portfolio/newsroom
git pull --ff-only
vercel env pull .env.local --yes
bun install && bun test
bun run build
bun run db:ping
bun --env-file=.env.local scripts/ops/check-data-state.ts
```

All 5 should return success. Any failure → diagnose before touching API
scaffolding.

---

## Session 8 commit list (all on `main`, no PRs)

```
d0b3e17  fix: right-rail panels stop clipping — sweep origin, flex-shrink, topics scroll
faff987  feat: YouTube sources never go to tier=excluded
7030e2d  feat: /podcasts featured↔all tier toggle
6a24167  fix: daybreak separator no longer shows two different dates
8c8658a  fix: s8 round 4 — healthy classification, monthly cap, calendar order, pagination
d0735c3  feat: s8 round 3 — calendar grid + bump home limit to 120
6ae8bf9  feat: s8 round 2 — admin/usage + admin/system rebuild, errored-source cleanup
d350caa  fix: s8 round 1 — radar data, save button, editor analysis, /all day picker
b0734fa  docs(s8-prep): add pre-built issue punch list for next session  ← s7's last
```
