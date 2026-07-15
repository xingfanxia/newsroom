# Agent Access — Public API + Skill + RSS

> **Status**: the three-track integration surface shipped 2026-05-13. Its R2-backed anonymous implementation is current in this feature branch, but the production migration, first release, deploy, and cutover are still gated; the external links below continue to describe the public contract, not proof that production has cut over.

External UI page for end users: [`/zh/agents`](https://news.ax0x.ai/zh/agents) (or `/en/agents`).

External canonical machine docs (served at runtime):
- [`/skill.md`](https://news.ax0x.ai/skill.md) — installable SKILL.md
- [`/openapi.yaml`](https://news.ax0x.ai/openapi.yaml) — OpenAPI 3.1 spec

## Three integration tracks

| Track | Auth | When to use | Where |
|---|---|---|---|
| **SKILL.md** | none | Claude Code / Codex CLI / Cursor / Gemini CLI / Cline / Windsurf — anything that speaks SKILL.md standard | `app/skill.md/route.ts` |
| **REST (public)** | none | Custom scripts / cron / bots — any HTTP client | `app/api/public/*` |
| **MCP / `/api/v1/*`** | Bearer token | Write actions (save / collections), audit trail, higher rate limits | `app/api/mcp/route.ts` + `app/api/v1/*` |

## Public REST surface

8 anonymous read-only endpoints under `/api/public/*`:

| Endpoint | Purpose | Rate limit |
|---|---|---|
| `GET /feed` | Main feed with full v1 filter surface | 600 r/min/IP |
| `GET /items/{id}` | Full item detail (bilingual + body_md + event block) | 600 r/min/IP |
| `GET /search` | Snapshot lexical search; anonymous semantic returns 422 | 120 r/min/IP |
| `GET /sources` | Source catalog + live health | 300 r/min/IP |
| `GET /events/{cluster_id}/members` | Multi-source event coverage | 600 r/min/IP |
| `GET /daily` | Latest daily AI column | 300 r/min/IP |
| `GET /daily/{YYYY-MM-DD}` | Daily column by date | 300 r/min/IP |
| `GET /dailies` | Daily column index (discovery) | 300 r/min/IP |

All endpoints return `weak ETag` + honor `If-None-Match` → 304. CORS open (`*`). Cache headers are centralized in `lib/api/public-endpoint-config.ts` and tuned per family (short for feed/search, longer for stable daily-column resources).

Anonymous JSON feed/search reads are served from the validated R2 snapshot through `lib/public-content/http.ts`; the reader needs only `R2_PUBLIC_BASE_URL`, and request volume does not query Turso. Lexical results update when the publisher advances the release pointer. Anonymous `mode=semantic` returns HTTP 422 `semantic_search_not_supported`; semantic retrieval remains on bearer-authenticated v1/MCP. Those private surfaces retain their `unstable_cache` data-layer caches (`feed-api` / `search-api`).

There is no DB fallback on an anonymous cache miss or snapshot failure.

## Field stripping (vs `/api/v1/*`)

LLM internals removed from public payloads:
- `reasoning` / `reasoningZh` / `reasoningEn` (raw LLM scoring rationale)
- `hkr.reasonsZh` / `hkr.reasonsEn` (per-axis LLM explanations) — booleans `h/k/r` retained
- `body_rss` (raw HTML — `body_md` retained for transcripts / article text)

Everything a user sees on the site stays: `importance`, `hkr` booleans, `tier`, `coverage`, `canonical_title`, `editor_note`, `editor_analysis` (锐评).

## Shared infrastructure

- **`lib/site.ts`** — canonical public origin (`https://news.ax0x.ai`) and URL builder used by sitemap, robots, RSS feeds, `/skill.md`, `/openapi.yaml`, and the `/agents` integration page so public discovery surfaces do not drift across domains.
- **`lib/api/public-endpoint-config.ts` + `lib/rate-limit/public.ts`** — one public endpoint contract for rate limits, cache policy, docs grouping, and endpoint count, plus the parameterized IP token-bucket. Public docs, `/skill.md`, `/openapi.yaml`, and `/agents` copy render or verify the same contract. Family-isolated so `/feed` polling doesn't burn `/search` budget.
- **`lib/api/public-helpers.ts`** — `publicCachedRoute(req, { endpoint: "<endpoint-key>", etagFamily, label, load })` applies the endpoint's IP token bucket, maps route-level 4xx results, computes ETags, handles `If-None-Match` 304s, applies the endpoint cache policy, and logs shared 5xx envelopes. `publicRouteResult` maps domain `{ ok, payload/error/status }` results into cached public `{ signal, body }` results. `publicError`, `publicInvalidQuery`, `publicServerError`, `publicHeaders`, and the lower-level rate-limit/ETag helpers stay here for explicit error and test coverage paths.
- **`lib/api/route-result.ts`** — one domain-result contract for route payload helpers: `RouteResult<T>` for optional-payload admin/session/v1 mappings and `RequiredPayloadRouteResult<T>` for plain/public helpers whose success path always carries a payload. Surface adapters own only the HTTP envelope.
- **`lib/api/plain-response.ts`** — shared plain JSON helpers for small legacy/internal HTTP routes that do not use public cache/rate-limit behavior, bearer auth, or `{ ok: ... }` envelopes. It owns `runPlainRoute(..., { serverErrorLabel })`, `plainJson`, `plainError`, `plainRouteResult`, and catch-all `plainServerError` mapping so these routes do not hand-copy `Response.json`, result-error, or generic `try/catch` branches.
- **`lib/api/ok-response.ts`** — shared `{ ok: true }` / `{ ok: false, error }` envelope helpers used by cookie-session, admin, and browser mutation routes. It returns `NextResponse` so login/logout helpers can set cookies without hand-copying JSON response shapes.
- **`lib/api/session-route.ts`** — shared cookie-session route adapter for required-session user endpoints. It owns session auth bridging, ok/error aliases, `sessionRouteResult` domain-result mapping, and catch-all server-error logging via `runSessionRoute(..., { serverErrorLabel })` so browser mutation leaf routes do not hand-copy auth, result-envelope, or generic `try/catch` branches.
- **`lib/api/admin-route.ts`** — shared cookie-admin route adapter for protected `/api/admin/*` endpoints. It owns admin auth bridging, ok/error aliases, `adminRouteResult` domain-result mapping, and catch-all server-error logging via `runAdminRoute(..., { serverErrorLabel })` so admin leaf routes do not hand-copy auth, result-envelope, or generic `try/catch` branches.
- **`lib/auth/api-token.ts`** — shared agent bearer auth for `/api/v1/*` and `/api/mcp`. It owns `Authorization: Bearer <token>` parsing, sha256 lookup, revocation checks, `last_used_at` bumps, and the shared 401 envelopes.
- **`lib/api/v1-route.ts`** — shared bearer-gated route envelope for `/api/v1/*`. It bridges `requireApiToken(req)` into a handler callback, owns catch-all server-error logging via `runV1Route(..., { serverErrorLabel })`, and owns the plain JSON/error helpers (`v1Json`, `v1Error`, `v1RouteResult`, `v1InvalidQuery`, `v1InvalidQueryResult`, `v1ServerError`), leaving v1 route files responsible only for choosing request parsers, success payload mappers, and business helpers.
- **`lib/api/query-params.ts`** — shared `URLSearchParams` extraction, Zod `safeParse` plumbing, and `invalid_query` issue formatting used by public + bearer-gated query routes. Surface adapters still choose their own error envelope (`publicInvalidQueryResult` vs `v1InvalidQueryResult`).
- **`lib/api/feed-query-params.ts`** — shared feed/search query schemas, MCP tool input shapes, and snake_case-to-internal query mapping for public, bearer-gated, and MCP surfaces; route files only choose auth/rate-limit/envelopes and per-surface limit ceilings.
- **`lib/types.ts`** — shared item tier, highlight-tier subset, feed view, search mode, app/source locale, source group/kind, source-health status, feedback vote, user role, iteration status, and cadence runtime tuples used by REST/MCP schemas, public/agent item source fields, cluster lead-pick authority typing, `/skill.md`, `/openapi.yaml`, sitemap generation, DB enums, fetcher support checks, score parsing, feedback routes, iteration routes, and commentary workers.
- **`lib/public-content/http.ts` + `lib/public-content/reader/*`** — the anonymous JSON ownership boundary. It validates and reads one R2 release, runs pure feed/search/source/item/event/daily adapters, preserves public envelopes/ETags, falls back to previous or warm last-known-good, and returns controlled 503 without a DB fallback.
- **`lib/api/feed-results.ts`** — live paired item + `total` execution and payload serialization for bearer `/api/v1/feed` and MCP `ax_radar_feed`. Its `unstable_cache` remains private-surface read-budget protection; anonymous feed no longer imports it.
- **`lib/api/search-results.ts`** — live lexical/semantic execution for bearer `/api/v1/search` and MCP `ax_radar_search`, including distance/latency metadata and cached embedding work. Anonymous search no longer imports it.
- **`lib/api/source-catalog.ts`** — live source catalog query + serializers for `/api/v1/sources` and MCP `ax_radar_sources`; anonymous catalog and source-picker routes use snapshot source entities.
- **`lib/api/public-items.ts`** — shared anonymous feed/search item serializer. It keeps the public `FeedItem` shape aligned across `/api/public/feed` and `/api/public/search`.
- **`lib/api/v1-items.ts`** — shared bearer-gated agent item serializer used directly by `/api/v1/feed`, `/api/v1/saved`, and MCP feed, and indirectly by search payload helpers.
- **`lib/api/story-item-fields.ts`** — shared flat Story field helpers used by both anonymous public serializers and bearer-gated `/api/v1/*` serializers, with each surface still owning its HKR exposure policy.
- **`lib/api/item-detail.ts`** — live full-detail lookup for bearer `/api/v1/items/{id}` and MCP `ax_radar_get_item`; anonymous item detail is projected from public snapshot entities.
- **`lib/api/event-member-contract.ts` + `lib/api/event-members.ts`** — pure event-member parsing/serialization shared with the snapshot adapter, plus the separate live lookup retained for v1/MCP.
- **`lib/api/route-params.ts`** — shared positive route-id parser and `invalid_id` label used by item-detail, event-member, and admin iteration routes.
- **`lib/api/policy-commit.ts`** — shared admin policy commit request schema and commit mapping; `/api/admin/policy/commit` keeps only admin auth, JSON body parsing, and response-envelope mapping.
- **`lib/api/iteration-routes.ts`** — shared admin iteration-run lookup/apply/reject result helpers; the `[id]` routes keep only admin auth, route-id parsing, and `adminRouteResult` response-envelope mapping.
- **`lib/api/daily-columns.ts` + `lib/daily-column/query-defaults.ts`** — live daily-column helpers retained for private/MCP. Anonymous pages and latest/date/index JSON read snapshot newsletters with the same bounds/defaults.
- **`lib/rss/*` + `lib/public-content/rss.ts` + `lib/public-content/rss-http.ts`** — shared RSS metadata/XML/HTTP contracts plus pure snapshot derivation for main, newsletter, and legacy slug feeds. Anonymous RSS routes no longer invoke the legacy DB query/cache modules; those modules remain only as pre-cutover/private compatibility code until the stability gate permits removal.
- **`lib/api/collection-requests.ts`** — shared saved-collection request schemas and duplicate-name detection used by cookie-gated `/api/admin/collections` and bearer-gated `/api/v1/collections`; each route still owns its auth surface and success shape, while `adminRouteResult` / `v1RouteResult` own result-to-envelope error mapping.
- **`lib/api/saved-requests.ts` + `lib/saved/query-defaults.ts`** — shared saved-item query request parser, query defaults/bounds, and mutation schemas used by bearer-gated `/api/v1/saved` and the browser saved-item move route; route files still own auth and envelopes, while shared route helpers own any cross-surface mutation semantics.
- **`lib/api/saved-routes.ts`** — shared saved-item route payload helpers used by bearer-gated `/api/v1/saved`, browser `/api/feedback/move`, and MCP `ax_radar_save`; it owns saved lookup, agent saved-item serialization, save toggling, owner-aware collection assignment and move semantics, assigned-collection payloads, and missing-item FK-to-`item_not_found` mapping while adapters keep their auth and response envelopes.
- **`lib/api/saved-export.ts`** — shared browser saved-export helper for Markdown dumps; `/api/saved/export` keeps only optional cookie-session fallback semantics, while this helper owns query parsing, saved item/collection lookup, Markdown rendering, attachment filenames, and response headers.
- **`lib/api/usage-summary.ts`** — shared bearer-gated LLM usage summary contract used by `/api/v1/usage/summary` and MCP `ax_radar_usage`, with request/window parsing, the default usage window, totals, task/model breakdowns, and recent call provider/model labels.
- **`lib/tweaks.ts` + `lib/watchlist.ts` + `lib/api/tweak-requests.ts` + `lib/api/tweak-routes.ts`** — shared tweak option contracts, defaults, watchlist trim/lowercase/dedupe helpers, PATCH validation, DB patch construction, and GET/PATCH route payload persistence used by the client site-config provider, cookie-gated `/api/tweaks`, and bearer-gated `/api/v1/tweaks`.

## Adding a new public endpoint

1. Create `app/api/public/<name>/route.ts`
2. Add its key, family, limit, cache policy, and doc grouping in `lib/api/public-endpoint-config.ts`
3. Enter through `publicCachedRoute(req, { endpoint: "<endpoint-key>", etagFamily: "public-<name>", label: "<route-label>", load })`
4. Add the required public entity or pure query/derivation to `lib/public-content/*`; the loader must consume the validated snapshot and must not import a DB-owning helper.
5. Inside `load`, build a stable `etagSignal({ ... })` — anything that changes when content updates — and return `{ ok: true, signal, body }`
6. For explicit 4xx branches, return `{ ok: false, error, status }`; for query validation use `publicInvalidQueryResult(issues)`
7. Reuse an existing domain request helper when one owns the endpoint contract; otherwise parse query strings with `parseQueryParams(req, schema)` from `lib/api/query-params.ts`
8. Strip LLM internals before returning
9. Update `/openapi.yaml` (in `app/openapi.yaml/route.ts`) with the new path
10. Update `/skill.md` (in `app/skill.md/route.ts`) intent table if user-visible
11. Update `/robots.ts` allow list if needed
12. Add unit test under `tests/api/`

## Discovery files

- `app/robots.ts` — allows `/api/public/*`, `/api/rss/*`, `/api/feed/*`, `/api/events/*`, `/skill.md`, `/openapi.yaml`; disallows `/admin`, `/api/v1/*`, `/api/mcp`, `/api/cron/*`, `/login`
- `app/sitemap.ts` — bilingual primary routes + `/skill.md` + `/openapi.yaml`. Daily archive (`/daily/[date]`) deliberately omitted from sitemap to avoid 1k+ URLs; reachable via index page

## Tests

- `tests/api/public-helpers.test.ts` — ETag determinism, family isolation, headers, CORS
- `tests/api/agent-auth-source.test.ts` — shared agent bearer auth stays centralized across `/api/v1/*` and `/api/mcp`, with current docs pointing at the same boundary
- `tests/api/v1-route-helper.test.ts` + `tests/api/v1-route-source.test.ts` — bearer auth and plain JSON/error envelopes stay centralized for every `/api/v1/*` handler
- `tests/api/public-ratelimit.test.ts` — threshold, IP isolation, family isolation, IPv4/IPv6 header fallback
- `tests/api/public-rate-limit-contract.test.ts` — public route handlers, `/skill.md`, `/openapi.yaml`, `/agents`, and docs stay wired to the shared public rate-limit contract
- `tests/api/feed-query-params.test.ts` — shared feed/search request helpers, MCP tool input helpers, parameter defaults, source filter validation, max-limit ceilings, tag parsing, and internal query mapping
- `tests/api/query-params*.test.ts` — generic request query parsing and route source wiring stay centralized instead of hand-copying `Object.fromEntries(url.searchParams.entries())`
- `tests/api/feed-tier-source.test.ts` — REST/MCP feed/search schemas, public/agent item source fields, cluster lead-pick typing, score parsing, and commentary workers stay wired to shared item-tier/feed-view/search-mode/source-filter tuples
- `tests/api/runtime-contracts-source.test.ts` — app/source locales, fetcher-supported source kinds, feedback vote values, user roles, and iteration statuses stay wired to shared runtime tuples
- `tests/api/feed-query-source.test.ts` — feed/search routes stay wired to shared query schemas and shared execution helpers
- `tests/api/admin-iterations-source.test.ts` — admin iteration routes stay wired to shared auth, route-id parsing, and iteration-run result helpers
- `tests/api/policy-commit.test.ts` — admin policy commit request validation plus real DB monotonic `policy_versions.version` writes stay covered
- `tests/api/public-feed.test.ts` — public feed reports a stable full-match `total` across page sizes
- `tests/api/public-search.test.ts` — public lexical search reports a stable full-match `total` across page sizes
- `tests/api/source-catalog.test.ts` — public, v1, MCP, and active source-picker source catalog serialization contracts
- `tests/api/source-catalog-source.test.ts` + `tests/api/sources-active-source.test.ts` — source routes and OpenAPI stay wired to shared source catalog/runtime tuple contracts
- `tests/api/skill-source.test.ts` — hosted `/skill.md` stays wired to shared runtime tuple contracts for installing agents
- `tests/api/public-items.test.ts` — anonymous feed/search item shape, HKR reason stripping, locale-specific event title fields
- `tests/api/item-detail.test.ts` — public/v1 full-detail item route id parsing, item shape, public HKR stripping, and event-aware ETag signal
- `tests/api/item-detail-source.test.ts` — public/v1/MCP item detail surfaces stay wired to the shared detail parser/query/serializer module
- `tests/api/event-members.test.ts` — shared event-member route/request parsing, payload envelopes, cache-signal parts, and item shape used by REST + MCP event coverage surfaces
- `tests/api/event-members-source.test.ts` — UI/public/v1 event-member routes and MCP stay wired to shared event-member payload helpers
- `tests/api/daily-columns.test.ts` — daily-column public request/payload helpers, REST serializers, ETag signals, UTC date windows, and MCP markdown renderer
- `tests/api/daily-columns-source.test.ts` — public daily routes and MCP daily resources stay wired to shared daily-column request/lookup/payload helpers
- `tests/api/collection-requests.test.ts` — shared saved-collection request schemas for admin camelCase bodies and v1 snake_case bodies
- `tests/api/collections-source.test.ts` — admin/v1 collection routes stay wired to shared collection request schemas
- `tests/api/collections.test.ts` — shared saved-collection route helpers cover owner-scoped create/list/update/delete, duplicate-name mapping, save counts, and delete-to-inbox reparenting
- `tests/api/saved-requests.test.ts` — shared saved-item query request parsing plus mutation and move request schemas
- `tests/api/saved-routes.test.ts` + `tests/api/saved-routes-source.test.ts` — saved list/write/move helper behavior and source wiring keep `/api/v1/saved` on shared list payload construction, `/api/feedback/move` on the shared move helper, and `/api/v1/saved` plus MCP `ax_radar_save` on the same save mutation path
- `tests/api/saved-export.test.ts` — browser saved-export query parsing, Markdown shape, deterministic filenames, and attachment headers
- `tests/api/tweak-requests.test.ts` — shared tweak PATCH validation, watchlist normalization, and DB patch construction for browser + bearer surfaces
- `tests/api/tweak-routes.test.ts` — shared tweak route payload contract and real DB GET/PATCH round-trip semantics
- `tests/api/tweaks-source.test.ts` — cookie/v1 tweak routes, the client provider, and right-rail watchlist UI stay wired to shared tweak/watchlist contracts
- `tests/api/feed-results.test.ts` — shared public/agent feed payload serialization from the feed execution result
- `tests/api/mcp-contract-source.test.ts` — MCP feed/search stay wired to shared input schemas, query mapping, execution, and payload helpers
- `tests/api/search-results.test.ts` — shared public/agent search payload serialization, including semantic distance/latency metadata and public stripping of agent-only embedding dimensions
- `tests/api/usage-summary.test.ts` — bearer-gated usage summary parses request windows and serializes totals, task/model breakdowns, and recent calls for agents
- `tests/api/v1-saved-source.test.ts` — `/api/v1/saved` stays wired to shared saved request parsing/schemas and shared saved route payload helpers
- `tests/site/public-origin.test.ts` — public discovery surfaces stay wired to the canonical public origin helper and the README uses the same production URL
- `tests/rss/legacy-feeds.test.ts` + `tests/rss/routes-source.test.ts` — legacy RSS slug feeds keep slug parsing/item mapping covered and route feed construction delegated
- `tests/rss/newsletter-feed.test.ts` — legacy structured newsletter RSS keeps locale fallback and item-content mapping covered
- `tests/llm/usage-display.test.ts` — admin usage labels, task tones, and compact formatting stay exhaustive over the runtime usage/task tuples
- `tests/llm/usage-stats-source.test.ts` — admin/v1/MCP usage surfaces stay wired to all-time windows, model labels, and the shared agent summary contract
- `tests/items/collections.test.ts` — saved collection assignment rejects cross-owner collection ids
- `tests/items/feed-source-filter-source.test.ts` — exact `source_id` feed filters win over source preset buckets and reader pages do not match publisher labels

Use the credential-scrubbing runner, for example `bun run test -- tests/api/public-feed.test.ts`; never pass `.env.local` to the default test command. The complete public serving boundary is `bun run verify:r2-public --criterion AC-010`.

## Operational notes

- **Rate limiter is Vercel-instance-local** — buckets don't survive cold starts. Treated as "discourage hammering" not "airtight cap." Real abuse defense lives at the CDN/WAF layer.
- **Public endpoint configuration is centralized** — add or change endpoint budgets/cache in `lib/api/public-endpoint-config.ts` first, then wire routes through `publicCachedRoute(req, { endpoint: "<endpoint-key>", etagFamily, label, load })`. `/skill.md`, `/openapi.yaml`, `/agents`, and this doc should never hand-copy a different limit or cache table.
- **Public 4xx/5xx envelopes are centralized** — public routes should return route-level `{ ok: false, error, status }` results from the `publicCachedRoute` loader, usually through `publicRouteResult` when a domain helper returns `{ ok, payload/error/status }`; thrown errors are logged by the shared helper and returned as `{ error: "server_error" }`. Keep domain-specific validation/404 decisions local, but not the HTTP envelope.
- **Cookie/admin ok envelopes are centralized** — `session-auth`, `admin-auth`, and `admin-session-routes` reuse `lib/api/ok-response.ts`; required-session leaf routes use `runSessionRoute(..., { serverErrorLabel })` plus `sessionRouteResult`, and protected admin leaf routes use `runAdminRoute(..., { serverErrorLabel })` plus `adminRouteResult`, for auth, catch-all 500, and domain result branches. They should not call `NextResponse.json({ ok: ... })` directly or hand-copy generic `try/catch` server-error branches. Login/logout request handling and cookie setting live in `lib/api/admin-session-routes.ts`, with cookie attributes still sourced from `freshAdminSessionCookie` / `expiredAdminSessionCookie`.
- **Bearer agent auth is shared across REST + MCP** — `/api/v1/*` routes enter through `runV1Route`, and `/api/mcp` calls `requireApiToken` directly because MCP has its own transport envelope. Do not add a route-local bearer parser, duplicate token lookup, or MCP-specific revocation path; keep token lifecycle in `lib/auth/api-token.ts`.
- **Field stripping is centralized for feed/search and item-detail surfaces** — `toPublicApiItem` strips HKR reasons for feed/search, while `toPublicItemDetail` strips detail-only LLM internals (`reasoning`, `body_rss`, HKR reasons). If adding a new domain field, update the relevant serializer and OpenAPI schema together.
- **Bearer agent item detail is centralized across REST + MCP** — `/api/v1/items/{id}` and MCP `ax_radar_get_item` both call `getAgentItemDetailRoutePayload`, which owns id parsing, DB lookup, and the full `toV1ItemDetail` payload with raw reasoning, HKR per-axis reasons, `body_md`, `body_rss`, and event diagnostics. Public item detail keeps a separate public serializer for stripped fields and ETag signals.
- **Feed/search query parsing is centralized** — `lib/public-content/http.ts`, v1 routes, and MCP use request/tool helpers in `lib/api/feed-query-params.ts`. Feed/search bounds still come from their query-default modules. Anonymous lexical execution uses `queryPublicFeed` over the validated snapshot; anonymous semantic returns the documented 422 before any snapshot, DB, or embedding call. V1/MCP retain live semantic execution.
- **Query extraction is centralized separately from envelopes** — reusable REST query helpers use `parseQueryParams` / `queryParamsRecord` from `lib/api/query-params.ts`, then surface adapters choose `publicInvalidQueryResult` or `v1InvalidQueryResult` so validation parsing cannot drift while response contracts remain surface-specific.
- **Anonymous feed/search execution is snapshot-only** — `/api/public/feed` and lexical `/api/public/search` call `queryPublicFeed` through `lib/public-content/http.ts`, preserving totals, ordering, filters, pagination, localization, field stripping and ETags without importing the live result caches. `/api/v1/*` and MCP continue through `runFeedQuery` / `runSearchQuery`.
- **Source catalog ownership is split by trust boundary** — anonymous catalog/source-picker responses project snapshot sources; v1/MCP use the live catalog module and may include their authenticated fields.
- **Bearer agent item serialization is shared across REST + MCP** — feed/search rows reach `toAgentApiItem` through `toAgentFeedPayload` and `toAgentSearchPayload`; `/api/v1/saved` gets its saved-item extension through `listSavedItemsRoutePayload` so leaf routes do not import serializers directly.
- **Saved collection assignment is owner-aware** — `/api/v1/saved` writes and MCP `ax_radar_save` enter through `saveItemRoutePayload`, while browser move actions enter through `moveSavedItemRoutePayload`; both paths reject another user's collection id before mutating assignment.
- **Saved collection request validation is shared across auth surfaces** — `/api/admin/collections` accepts browser camelCase bodies while `/api/v1/collections` accepts agent snake_case bodies, but both normalize through `lib/api/collection-requests.ts` before calling `lib/items/collections.ts`; collection leaf routes map domain `{ ok, payload/error/status }` results through `adminRouteResult` or `v1RouteResult` instead of hand-copying failure branches.
- **Admin policy commit validation is centralized** — `/api/admin/policy/commit` parses `policyCommitBodySchema` and calls `commitPolicyRoutePayload`; the route file should not define route-local Zod schemas or import `commitSkillVersion` directly.
- **Admin iteration routes delegate run semantics** — `/api/admin/iterations/run` enters through `runAdminIterationStartRoute`, while `/api/admin/iterations/[id]`, `/apply`, and `/reject` enter through `runAdminIterationIdRoute(..., { serverErrorLabel })`. `lib/api/iteration-routes.ts` owns admin auth, route-id parsing, agent-run guard errors, catch-all server-error logging, and maps iteration payload results through `adminRouteResult` before calling the shared iteration payload helpers. Route files should not import Drizzle, `iterationRuns`, `parseIterationRunRouteId`, `runIteration`, `commitSkillVersion`, status tuples, cache invalidation, or generic `try/catch` directly.
- **Saved item request validation and export rendering are shared across saved surfaces** — `/api/v1/saved` parses GET queries through `parseV1SavedQueryRequest`, with list bounds/defaults from `lib/saved/query-defaults.ts`; `/api/v1/saved` and `/api/feedback/move` parse mutation bodies through `lib/api/saved-requests.ts`, and `/api/feedback/move` delegates move semantics to `moveSavedItemRoutePayload`; cookie-session save-move failures map through `sessionRouteResult`, `APP_LOCALES` remains the locale source for saved queries, inbox moves preserve `targetCollectionId: null`, and `/api/saved/export` delegates Markdown/attachment construction to `lib/api/saved-export.ts`.
- **Tweak validation is shared across browser + agent surfaces** — `lib/tweaks.ts` owns site-config option values and defaults, `lib/watchlist.ts` owns watchlist trim/lowercase/case-insensitive dedupe, and `/api/tweaks` plus `/api/v1/tweaks` both parse PATCH bodies and build DB patches through `lib/api/tweak-requests.ts`; cookie-session tweak save failures map through `sessionRouteResult`.
- **Event-member contracts are shared, execution is split** — anonymous UI/public routes use snapshot event/member entities; v1/MCP use the live loader. Locale defaults and the pure parser/serializer remain shared.
- **Daily pages and JSON are snapshot-only** — anonymous latest/date/index routes and locale pages query snapshot newsletters with shared bounds/defaults. Live daily-column helpers remain for v1/MCP.
- **All anonymous RSS families are snapshot-only** — main locale, newsletter, and `/api/rss/{daily,today,curated}.xml` bytes are derived through `lib/public-content/rss.ts` from the validated release. Route-level rate limits and HTTP headers remain, but a cache miss cannot reach Turso.
- **Usage summary request parsing and serialization is centralized across bearer agent surfaces** — `/api/v1/usage/summary` parses requests through `parseUsageSummaryQueryRequest`, while MCP `ax_radar_usage` uses `usageSummaryWindowSchema` and `usageWindowOrDefault`; both call `getUsageSummary`. The helper owns the `today|week|month|all` window set, default `week` window, totals, `by_task`, `by_model`, and `recent_calls` shape.
- **Usage presentation is centralized for the admin surface** — `lib/llm/usage-display.ts` owns usage range labels, task badge tones, compact token/call formatting, sparkline date labels, and task-model summaries; tests keep those helpers exhaustive over `USAGE_WINDOWS` and `LLM_TASKS`.
- **v1 bearer auth + plain JSON envelopes are centralized** — route handlers under `/api/v1/*` should call `runV1Route(req, async (user) => ..., { serverErrorLabel })` and return `v1Json`, `v1RouteResult`, or `v1InvalidQueryResult`. Do not call `requireApiToken`, `Response.json`, `v1ServerError`, or hand-copy `try/catch` plus `server_error` responses directly in v1 leaf routes. MCP is the only route adapter that should call `requireApiToken` directly, because it must hand control to the MCP transport after auth. Put reusable or contract-bearing request schemas in `lib/api/*-requests.ts`; keep surface-specific success payload mapping in the route unless a shared route helper already owns that behavior.

## Related

- Original design: [`../AGENT-MCP-PLAN.md`](../AGENT-MCP-PLAN.md) — s9 plan for `/api/v1/*` + MCP server (bearer-gated track, predates public mirror)
- Architecture milestones: [`../architecture/ingestion.md`](../architecture/ingestion.md) § 6 — deviation entry for 2026-05-13 public API
