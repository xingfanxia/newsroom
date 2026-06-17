# Agent Access — Public API + Skill + RSS

> **Status**: shipped 2026-05-13 (PR #36). Three-track integration surface inspired by AI HOT's `/agent-access` model.

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
| `GET /search` | Lexical / semantic search | 120 r/min/IP (LLM cost) |
| `GET /sources` | Source catalog + live health | 300 r/min/IP |
| `GET /events/{cluster_id}/members` | Multi-source event coverage | 600 r/min/IP |
| `GET /daily` | Latest daily AI column | 300 r/min/IP |
| `GET /daily/{YYYY-MM-DD}` | Daily column by date | 300 r/min/IP |
| `GET /dailies` | Daily column index (discovery) | 300 r/min/IP |

All endpoints return `weak ETag` + honor `If-None-Match` → 304. CORS open (`*`). Cache headers are centralized in `lib/api/public-endpoint-config.ts` and tuned per family (short for live feed/search, longer for stable daily-column resources).

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
- **`lib/api/plain-response.ts`** — shared plain JSON helpers for small legacy/internal HTTP routes that do not use public cache/rate-limit behavior, bearer auth, or `{ ok: ... }` envelopes. It owns `plainJson`, `plainError`, `plainRouteResult`, and catch-all `plainServerError` mapping so these routes do not hand-copy `Response.json` or result-error branches.
- **`lib/api/ok-response.ts`** — shared `{ ok: true }` / `{ ok: false, error }` envelope helpers used by cookie-session, admin, and browser mutation routes. It returns `NextResponse` so login/logout helpers can set cookies without hand-copying JSON response shapes.
- **`lib/api/session-route.ts`** — shared cookie-session route adapter for required-session user endpoints. It owns session auth bridging, ok/error aliases, `sessionRouteResult` domain-result mapping, and shared server-error logging so browser mutation leaf routes do not hand-copy auth or result-envelope branches.
- **`lib/api/admin-route.ts`** — shared cookie-admin route adapter for protected `/api/admin/*` endpoints. It owns admin auth bridging, ok/error aliases, `adminRouteResult` domain-result mapping, and shared server-error logging so admin leaf routes do not hand-copy auth or result-envelope branches.
- **`lib/auth/api-token.ts`** — shared agent bearer auth for `/api/v1/*` and `/api/mcp`. It owns `Authorization: Bearer <token>` parsing, sha256 lookup, revocation checks, `last_used_at` bumps, and the shared 401 envelopes.
- **`lib/api/v1-route.ts`** — shared bearer-gated route envelope for `/api/v1/*`. It bridges `requireApiToken(req)` into a handler callback, owns catch-all server-error logging via `runV1Route(..., { serverErrorLabel })`, and owns the plain JSON/error helpers (`v1Json`, `v1Error`, `v1RouteResult`, `v1InvalidQuery`, `v1InvalidQueryResult`, `v1ServerError`), leaving v1 route files responsible only for choosing request parsers, success payload mappers, and business helpers.
- **`lib/api/query-params.ts`** — shared `URLSearchParams` extraction, Zod `safeParse` plumbing, and `invalid_query` issue formatting used by public + bearer-gated query routes. Surface adapters still choose their own error envelope (`publicInvalidQueryResult` vs `v1InvalidQueryResult`).
- **`lib/api/feed-query-params.ts`** — shared feed/search query schemas, MCP tool input shapes, and snake_case-to-internal query mapping for public, bearer-gated, and MCP surfaces; route files only choose auth/rate-limit/envelopes and per-surface limit ceilings.
- **`lib/types.ts`** — shared item tier, highlight-tier subset, feed view, search mode, app/source locale, source group/kind, source-health status, feedback vote, user role, iteration status, and cadence runtime tuples used by REST/MCP schemas, public/agent item source fields, cluster lead-pick authority typing, `/skill.md`, `/openapi.yaml`, sitemap generation, DB enums, fetcher support checks, score parsing, feedback routes, iteration routes, and commentary workers.
- **`lib/api/feed-results.ts`** — shared feed execution and response payload serialization for `/api/public/feed`, `/api/v1/feed`, and MCP `ax_radar_feed`; surface adapters own only auth/rate-limit/ETag/envelopes, while this helper owns paired item + `total` queries, pagination defaults, and public vs agent item exposure.
- **`lib/api/search-results.ts`** — shared lexical/semantic search execution and response payload serialization for `/api/public/search`, `/api/v1/search`, and MCP `ax_radar_search`; surface adapters own only auth/rate-limit/ETag/envelopes, while this helper owns lexical `total` counts, semantic filter mapping, distance/latency metadata, and public vs agent item exposure.
- **`lib/api/source-catalog.ts`** — shared source catalog query + serializers used by `/api/public/sources`, `/api/v1/sources`, `/api/sources/active`, and MCP `ax_radar_sources`, with public/v1/MCP/source-picker each owning only its exposure policy.
- **`lib/api/public-items.ts`** — shared anonymous feed/search item serializer. It keeps the public `FeedItem` shape aligned across `/api/public/feed` and `/api/public/search`.
- **`lib/api/v1-items.ts`** — shared bearer-gated agent item serializer used directly by `/api/v1/feed`, `/api/v1/saved`, and MCP feed, and indirectly by search payload helpers.
- **`lib/api/story-item-fields.ts`** — shared flat Story field helpers used by both anonymous public serializers and bearer-gated `/api/v1/*` serializers, with each surface still owning its HKR exposure policy.
- **`lib/api/item-detail.ts`** — shared full-detail item route id parsing, query, bearer-agent payload helper, and serializers used by `/api/public/items/{id}`, `/api/v1/items/{id}`, and MCP `ax_radar_get_item`. The bearer-agent serializer keeps raw reasoning + RSS body; the public serializer strips LLM internals and uses an event-aware ETag signal.
- **`lib/api/event-members.ts`** — shared event-member request/query parsing, DB-backed payload lookup, list-envelope mapping, cache-signal parts, and item serializer used by UI-internal, public, v1, and MCP event-member surfaces.
- **`lib/api/route-params.ts`** — shared positive route-id parser and `invalid_id` label used by item-detail, event-member, and admin iteration routes.
- **`lib/api/policy-commit.ts`** — shared admin policy commit request schema and commit mapping; `/api/admin/policy/commit` keeps only admin auth, JSON body parsing, and response-envelope mapping.
- **`lib/api/iteration-routes.ts`** — shared admin iteration-run lookup/apply/reject result helpers; the `[id]` routes keep only admin auth, route-id parsing, and `adminRouteResult` response-envelope mapping.
- **`lib/api/daily-columns.ts`** — shared daily-column query, public request/query parsing, route lookup/payload helpers, REST serializers, ETag signals, date-window helpers, and MCP markdown renderer used by the public daily endpoints, site daily pages, `/api/rss/daily.xml`, and MCP daily resources.
- **`lib/rss/render.ts`** — shared RSS 2.0 XML and HTTP response envelope for `/api/rss/*`, `/api/feed/{locale}/rss.xml`, and the legacy newsletter RSS route, including XML escaping, safe `content:encoded` CDATA splitting, feed namespaces, extension elements, cache headers, content type, and lightweight markdown-ish HTML rendering.
- **`lib/rss/legacy-feeds.ts`** — shared feed metadata, row queries, and RSS item mapping for `/api/rss/{daily,today,curated}.xml`; the dynamic slug route owns only rate-limit/slug validation/404/response mapping.
- **`lib/rss/newsletter-feed.ts`** — shared locale normalization, structured-digest query, and RSS item/channel mapping for `/api/feed/newsletter/{locale}/rss.xml`; the route owns only the HTTP response envelope.
- **`lib/api/collection-requests.ts`** — shared saved-collection request schemas and duplicate-name detection used by cookie-gated `/api/admin/collections` and bearer-gated `/api/v1/collections`; each route still owns its auth surface and success shape, while `adminRouteResult` / `v1RouteResult` own result-to-envelope error mapping.
- **`lib/api/saved-requests.ts`** — shared saved-item query request parser and mutation schemas used by bearer-gated `/api/v1/saved` and the browser saved-item move route; route files still own auth and envelopes, while shared route helpers own any cross-surface mutation semantics.
- **`lib/api/saved-routes.ts`** — shared saved-item route payload helpers used by bearer-gated `/api/v1/saved`, browser `/api/feedback/move`, and MCP `ax_radar_save`; it owns saved lookup, agent saved-item serialization, save toggling, owner-aware collection assignment and move semantics, assigned-collection payloads, and missing-item FK-to-`item_not_found` mapping while adapters keep their auth and response envelopes.
- **`lib/api/saved-export.ts`** — shared browser saved-export helper for Markdown dumps; `/api/saved/export` keeps only optional cookie-session fallback semantics, while this helper owns query parsing, saved item/collection lookup, Markdown rendering, attachment filenames, and response headers.
- **`lib/api/usage-summary.ts`** — shared bearer-gated LLM usage summary contract used by `/api/v1/usage/summary` and MCP `ax_radar_usage`, with request/window parsing, the default usage window, totals, task/model breakdowns, and recent call provider/model labels.
- **`lib/tweaks.ts` + `lib/watchlist.ts` + `lib/api/tweak-requests.ts` + `lib/api/tweak-routes.ts`** — shared tweak option contracts, defaults, watchlist trim/lowercase/dedupe helpers, PATCH validation, DB patch construction, and GET/PATCH route payload persistence used by the client site-config provider, cookie-gated `/api/tweaks`, and bearer-gated `/api/v1/tweaks`.

## Adding a new public endpoint

1. Create `app/api/public/<name>/route.ts`
2. Add its key, family, limit, cache policy, and doc grouping in `lib/api/public-endpoint-config.ts`
3. Enter through `publicCachedRoute(req, { endpoint: "<endpoint-key>", etagFamily: "public-<name>", label: "<route-label>", load })`
4. Inside `load`, build a stable `etagSignal({ ... })` — anything that changes when content updates — and return `{ ok: true, signal, body }`
5. For explicit 4xx branches, return `{ ok: false, error, status }`; for query validation use `publicInvalidQueryResult(issues)`
6. Reuse an existing domain request helper when one owns the endpoint contract; otherwise parse query strings with `parseQueryParams(req, schema)` from `lib/api/query-params.ts`
7. Strip LLM internals before returning
8. Update `/openapi.yaml` (in `app/openapi.yaml/route.ts`) with the new path
9. Update `/skill.md` (in `app/skill.md/route.ts`) intent table if user-visible
10. Update `/robots.ts` allow list if needed
11. Add unit test under `tests/api/`

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

Run these with `bun test --env-file=.env.local tests/api/public-*.test.ts tests/api/agent-auth-source.test.ts tests/api/feed-results.test.ts tests/api/feed-query-*.test.ts tests/api/query-params*.test.ts tests/api/source-catalog*.test.ts tests/api/sources-active-source.test.ts tests/api/skill-source.test.ts tests/api/item-detail*.test.ts tests/api/event-members*.test.ts tests/api/daily-columns*.test.ts tests/api/policy-commit.test.ts tests/api/collection*.test.ts tests/api/saved-*.test.ts tests/api/tweak*.test.ts tests/api/mcp-contract-source.test.ts tests/api/usage-summary.test.ts tests/api/v1-route-*.test.ts tests/api/v1-saved-source.test.ts tests/llm/usage-display.test.ts tests/llm/usage-stats-source.test.ts tests/items/collections.test.ts tests/items/feed-source-filter-source.test.ts`.

## Operational notes

- **Rate limiter is Vercel-instance-local** — buckets don't survive cold starts. Treated as "discourage hammering" not "airtight cap." Real abuse defense lives at the CDN/WAF layer.
- **Public endpoint configuration is centralized** — add or change endpoint budgets/cache in `lib/api/public-endpoint-config.ts` first, then wire routes through `publicCachedRoute(req, { endpoint: "<endpoint-key>", etagFamily, label, load })`. `/skill.md`, `/openapi.yaml`, `/agents`, and this doc should never hand-copy a different limit or cache table.
- **Public 4xx/5xx envelopes are centralized** — public routes should return route-level `{ ok: false, error, status }` results from the `publicCachedRoute` loader, usually through `publicRouteResult` when a domain helper returns `{ ok, payload/error/status }`; thrown errors are logged by the shared helper and returned as `{ error: "server_error" }`. Keep domain-specific validation/404 decisions local, but not the HTTP envelope.
- **Cookie/admin ok envelopes are centralized** — `session-auth`, `admin-auth`, and `admin-session-routes` reuse `lib/api/ok-response.ts`; required-session leaf routes use `runSessionRoute` plus `sessionRouteResult`, and protected admin leaf routes use `runAdminRoute` plus `adminRouteResult`, for domain result branches. They should not call `NextResponse.json({ ok: ... })` directly. Login/logout still own cookie setting through `freshAdminSessionCookie` / `expiredAdminSessionCookie`.
- **Bearer agent auth is shared across REST + MCP** — `/api/v1/*` routes enter through `runV1Route`, and `/api/mcp` calls `requireApiToken` directly because MCP has its own transport envelope. Do not add a route-local bearer parser, duplicate token lookup, or MCP-specific revocation path; keep token lifecycle in `lib/auth/api-token.ts`.
- **Field stripping is centralized for feed/search and item-detail surfaces** — `toPublicApiItem` strips HKR reasons for feed/search, while `toPublicItemDetail` strips detail-only LLM internals (`reasoning`, `body_rss`, HKR reasons). If adding a new domain field, update the relevant serializer and OpenAPI schema together.
- **Bearer agent item detail is centralized across REST + MCP** — `/api/v1/items/{id}` and MCP `ax_radar_get_item` both call `getAgentItemDetailRoutePayload`, which owns id parsing, DB lookup, and the full `toV1ItemDetail` payload with raw reasoning, HKR per-axis reasons, `body_md`, `body_rss`, and event diagnostics. Public item detail keeps a separate public serializer for stripped fields and ETag signals.
- **Feed/search query parsing is centralized** — `/api/public/feed`, `/api/public/search`, `/api/v1/feed`, and `/api/v1/search` call request helpers in `lib/api/feed-query-params.ts`; MCP `ax_radar_feed` and `ax_radar_search` use the same module's tool input shapes plus default/query mapping helpers. Leaf routes do not construct `URL` objects, import query schemas, or hand-write feed/search defaults. Public/v1/MCP max limits can differ by surface. Feed-facing tier values come from `VISIBLE_ITEM_TIERS`, highlight/deep-dive tier checks come from `HIGHLIGHT_ITEM_TIERS` / `isHighlightItemTier`, `today|archive` comes from `FEED_VIEWS`, `lexical|semantic` comes from `SEARCH_MODES`, and `source_group` / `source_kind` come from `SOURCE_GROUPS` / `SOURCE_KINDS`, all in `lib/types.ts`; exact `source_id` filters win over source-group/source-kind buckets. MCP, `/skill.md`, and `/openapi.yaml` render or validate those same runtime tuples instead of repeating enum lists.
- **Query extraction is centralized separately from envelopes** — reusable REST query helpers use `parseQueryParams` / `queryParamsRecord` from `lib/api/query-params.ts`, then surface adapters choose `publicInvalidQueryResult` or `v1InvalidQueryResult` so validation parsing cannot drift while response contracts remain surface-specific.
- **Feed execution and payload serialization are centralized for REST + MCP** — `/api/public/feed`, `/api/v1/feed`, and MCP `ax_radar_feed` all call `runFeedQuery`, then `toPublicFeedPayload` or `toAgentFeedPayload`; adapters keep only auth/rate-limit/ETag/envelopes while the helper keeps item rows, `total` counts, pagination fields, and item exposure aligned.
- **Search execution and payload serialization are centralized for REST + MCP** — `/api/public/search`, `/api/v1/search`, and MCP `ax_radar_search` all call `runSearchQuery`, then `toPublicSearchPayload` or `toAgentSearchPayload`; lexical mode counts the full filtered match set for pagination, semantic mode shares the same source/date/tier filter mapping, and distance/latency/embedding metadata cannot drift across surfaces.
- **Source catalog serialization is centralized** — `/api/public/sources`, `/api/v1/sources`, `/api/sources/active`, and MCP `ax_radar_sources` share `lib/api/source-catalog.ts`; public strips operational diagnostics, v1 keeps them, the active source picker keeps only compact identity fields, and MCP keeps a compact flat shape.
- **Bearer agent item serialization is shared across REST + MCP** — feed/search rows reach `toAgentApiItem` through `toAgentFeedPayload` and `toAgentSearchPayload`; `/api/v1/saved` gets its saved-item extension through `listSavedItemsRoutePayload` so leaf routes do not import serializers directly.
- **Saved collection assignment is owner-aware** — `/api/v1/saved` writes and MCP `ax_radar_save` enter through `saveItemRoutePayload`, while browser move actions enter through `moveSavedItemRoutePayload`; both paths reject another user's collection id before mutating assignment.
- **Saved collection request validation is shared across auth surfaces** — `/api/admin/collections` accepts browser camelCase bodies while `/api/v1/collections` accepts agent snake_case bodies, but both normalize through `lib/api/collection-requests.ts` before calling `lib/items/collections.ts`; collection leaf routes map domain `{ ok, payload/error/status }` results through `adminRouteResult` or `v1RouteResult` instead of hand-copying failure branches.
- **Admin policy commit validation is centralized** — `/api/admin/policy/commit` parses `policyCommitBodySchema` and calls `commitPolicyRoutePayload`; the route file should not define route-local Zod schemas or import `commitSkillVersion` directly.
- **Admin iteration id routes delegate run semantics** — `/api/admin/iterations/[id]`, `/apply`, and `/reject` enter through `runAdminIterationIdRoute`, which owns admin auth, route-id parsing, and maps iteration payload results through `adminRouteResult` before calling the shared iteration payload helpers. Route files should not import Drizzle, `iterationRuns`, `parseIterationRunRouteId`, `commitSkillVersion`, status tuples, or cache invalidation directly.
- **Saved item request validation and export rendering are shared across saved surfaces** — `/api/v1/saved` parses GET queries through `parseV1SavedQueryRequest`, `/api/v1/saved` and `/api/feedback/move` parse mutation bodies through `lib/api/saved-requests.ts`, and `/api/feedback/move` delegates move semantics to `moveSavedItemRoutePayload`; cookie-session save-move failures map through `sessionRouteResult`, `APP_LOCALES` remains the locale source for saved queries, inbox moves preserve `targetCollectionId: null`, and `/api/saved/export` delegates Markdown/attachment construction to `lib/api/saved-export.ts`.
- **Tweak validation is shared across browser + agent surfaces** — `lib/tweaks.ts` owns site-config option values and defaults, `lib/watchlist.ts` owns watchlist trim/lowercase/case-insensitive dedupe, and `/api/tweaks` plus `/api/v1/tweaks` both parse PATCH bodies and build DB patches through `lib/api/tweak-requests.ts`; cookie-session tweak save failures map through `sessionRouteResult`.
- **Event-member payload execution is shared across surfaces** — `/api/events/*`, `/api/public/events/*`, and `/api/v1/events/*` call `getEventMembersRequestPayload` for route-id parsing, locale query extraction/validation, DB lookup, and `{ cluster_id, members, total }` assembly. Shared helpers also own the UI/v1 `{ members, total }` envelope and public ETag signal parts. MCP `ax_radar_event_members` calls `getEventMembersPayload` directly after its Zod input validation. Positive route IDs still come from `lib/api/route-params.ts`; adapters keep only auth/rate-limit/cache/error-envelope choices, with the legacy UI route mapping domain failures through `plainRouteResult` and the public route mapping cached failures through `publicRouteResult`.
- **Daily-column lookup and serialization is centralized across REST, RSS, site pages, and MCP** — `lib/api/daily-columns.ts` owns `newsletters` queries for `DAILY_NEWSLETTER_KIND` rows with `column_title IS NOT NULL`, public request/query parsing, public JSON bodies + ETag signals, route-ready public lookup results, UTC date-window lookup, RSS/page row listing, and MCP markdown text. Public daily routes keep only rate-limit/cache/error-envelope mapping; MCP daily resources keep only resource envelope mapping. Newsletter kind and locale labels come from `NEWSLETTER_KINDS` / `NEWSLETTER_LOCALES` in `lib/types.ts`. The legacy structured-digest rows (where `headline IS NOT NULL`) ship separately via `/api/feed/newsletter/{locale}/rss.xml`.
- **RSS rendering is centralized across feed families** — `lib/rss/render.ts` owns the RSS XML envelope, response content type/cache headers, XML escaping, `content:encoded` CDATA safety, namespaces, and extension fields; route files choose data and channel metadata only.
- **Legacy RSS slug feed construction is centralized** — `/api/rss/{daily,today,curated}.xml` delegates feed metadata, DB row queries, and `RssItem` mapping to `lib/rss/legacy-feeds.ts`; the route file keeps only rate-limit, slug validation, 404 handling, and `rssResponse`.
- **Legacy newsletter RSS construction is centralized** — `/api/feed/newsletter/{locale}/rss.xml` delegates locale fallback, legacy structured-digest filtering (`headline IS NOT NULL`), content HTML, and channel metadata to `lib/rss/newsletter-feed.ts`; the route file keeps only `rssResponse`.
- **Usage summary request parsing and serialization is centralized across bearer agent surfaces** — `/api/v1/usage/summary` parses requests through `parseUsageSummaryQueryRequest`, while MCP `ax_radar_usage` uses `usageSummaryWindowSchema` and `usageWindowOrDefault`; both call `getUsageSummary`. The helper owns the `today|week|month|all` window set, default `week` window, totals, `by_task`, `by_model`, and `recent_calls` shape.
- **Usage presentation is centralized for the admin surface** — `lib/llm/usage-display.ts` owns usage range labels, task badge tones, compact token/call formatting, sparkline date labels, and task-model summaries; tests keep those helpers exhaustive over `USAGE_WINDOWS` and `LLM_TASKS`.
- **v1 bearer auth + plain JSON envelopes are centralized** — route handlers under `/api/v1/*` should call `runV1Route(req, async (user) => ..., { serverErrorLabel })` and return `v1Json`, `v1RouteResult`, or `v1InvalidQueryResult`. Do not call `requireApiToken`, `Response.json`, `v1ServerError`, or hand-copy `try/catch` plus `server_error` responses directly in v1 leaf routes. MCP is the only route adapter that should call `requireApiToken` directly, because it must hand control to the MCP transport after auth. Put reusable or contract-bearing request schemas in `lib/api/*-requests.ts`; keep surface-specific success payload mapping in the route unless a shared route helper already owns that behavior.

## Related

- Original design: [`../AGENT-MCP-PLAN.md`](../AGENT-MCP-PLAN.md) — s9 plan for `/api/v1/*` + MCP server (bearer-gated track, predates public mirror)
- Architecture milestones: [`../architecture/ingestion.md`](../architecture/ingestion.md) § 6 — deviation entry for 2026-05-13 public API
