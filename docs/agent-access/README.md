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

All endpoints return `weak ETag` + honor `If-None-Match` → 304. CORS open (`*`). Cache headers tuned per family (60s for live data, 3600s+ for immutable historical dailies).

## Field stripping (vs `/api/v1/*`)

LLM internals removed from public payloads:
- `reasoning` / `reasoningZh` / `reasoningEn` (raw LLM scoring rationale)
- `hkr.reasonsZh` / `hkr.reasonsEn` (per-axis LLM explanations) — booleans `h/k/r` retained
- `body_rss` (raw HTML — `body_md` retained for transcripts / article text)

Everything a user sees on the site stays: `importance`, `hkr` booleans, `tier`, `coverage`, `canonical_title`, `editor_note`, `editor_analysis` (锐评).

## Shared infrastructure

- **`lib/rate-limit/public.ts`** — parameterized IP token-bucket. Each route picks `{ family, windowMs, max }`. Family-isolated so `/feed` polling doesn't burn `/search` budget.
- **`lib/api/public-helpers.ts`** — `computeEtag`, `ifNoneMatch`, `notModified`, `publicJson`, `publicError`, `publicHeaders`. Every route returns CORS + cache headers via these.
- **`lib/api/feed-query-params.ts`** — shared feed/search query schemas and snake_case-to-`FeedQuery` mapping for public + bearer-gated surfaces; route files only choose auth/rate-limit and per-surface limit ceilings.
- **`lib/api/feed-results.ts`** — shared feed execution for `/api/public/feed` and `/api/v1/feed`; route files own auth/rate-limit/ETag and serializers, while this helper owns paired item + `total` queries and pagination defaults.
- **`lib/api/search-results.ts`** — shared lexical/semantic search execution for `/api/public/search` and `/api/v1/search`; route files own auth/rate-limit/ETag and serializers, while this helper owns lexical `total` counts and semantic filter mapping.
- **`lib/api/source-catalog.ts`** — shared source catalog query + serializers used by `/api/public/sources`, `/api/v1/sources`, and MCP `ax_radar_sources`, with public/v1/MCP each owning only its exposure policy.
- **`lib/api/public-items.ts`** — shared anonymous feed/search item serializer. It keeps the public `FeedItem` shape aligned across `/api/public/feed` and `/api/public/search`.
- **`lib/api/v1-items.ts`** — shared bearer-gated agent item serializer used by `/api/v1/feed`, `/api/v1/search`, `/api/v1/saved`, and MCP feed/search tools.
- **`lib/api/story-item-fields.ts`** — shared flat Story field helpers used by both anonymous public serializers and bearer-gated `/api/v1/*` serializers, with each surface still owning its HKR exposure policy.
- **`lib/api/item-detail.ts`** — shared full-detail item route id parsing, query, and serializers used by `/api/public/items/{id}` and `/api/v1/items/{id}`. The v1 serializer keeps raw reasoning + RSS body; the public serializer strips LLM internals and uses an event-aware ETag signal.
- **`lib/api/event-members.ts`** — shared event-member route param parsing and item serializer used by UI-internal, public, v1, and MCP event-member surfaces.
- **`lib/api/daily-columns.ts`** — shared daily-column query, REST serializers, ETag signals, date-window helpers, and MCP markdown renderer used by the public daily endpoints, site daily pages, `/api/rss/daily.xml`, and MCP daily resources.
- **`lib/api/collection-requests.ts`** — shared saved-collection request schemas and duplicate-name detection used by cookie-gated `/api/admin/collections` and bearer-gated `/api/v1/collections`; each route still owns its auth and response envelope.
- **`lib/tweaks.ts` + `lib/api/tweak-requests.ts`** — shared tweak option contracts, defaults, PATCH validation, and DB patch construction used by the client site-config provider, cookie-gated `/api/tweaks`, and bearer-gated `/api/v1/tweaks`.

## Adding a new public endpoint

1. Create `app/api/public/<name>/route.ts`
2. Call `publicRateLimit(req, { family: "public-<name>", windowMs: 60_000, max: ... })` at the top
3. Build a stable `etagSignal({ ... })` — anything that changes when content updates
4. Use `publicJson(body, etag, { sMaxAge, staleWhileRevalidate })` for 200, `publicError(msg, code)` for 4xx/5xx
5. Strip LLM internals before returning
6. Update `/openapi.yaml` (in `app/openapi.yaml/route.ts`) with the new path
7. Update `/skill.md` (in `app/skill.md/route.ts`) intent table if user-visible
8. Update `/robots.ts` allow list if needed
9. Add unit test under `tests/api/`

## Discovery files

- `app/robots.ts` — allows `/api/public/*`, `/api/rss/*`, `/api/feed/*`, `/api/events/*`, `/skill.md`, `/openapi.yaml`; disallows `/admin`, `/api/v1/*`, `/api/mcp`, `/api/cron/*`, `/login`
- `app/sitemap.ts` — bilingual primary routes + `/skill.md` + `/openapi.yaml`. Daily archive (`/daily/[date]`) deliberately omitted from sitemap to avoid 1k+ URLs; reachable via index page

## Tests

- `tests/api/public-helpers.test.ts` — ETag determinism, family isolation, headers, CORS
- `tests/api/public-ratelimit.test.ts` — threshold, IP isolation, family isolation, IPv4/IPv6 header fallback
- `tests/api/feed-query-params.test.ts` — shared feed/search parameter defaults, max-limit ceilings, tag parsing, and `FeedQuery` mapping
- `tests/api/feed-query-source.test.ts` — feed/search routes stay wired to shared query schemas and shared execution helpers
- `tests/api/public-feed.test.ts` — public feed reports a stable full-match `total` across page sizes
- `tests/api/public-search.test.ts` — public lexical search reports a stable full-match `total` across page sizes
- `tests/api/source-catalog.test.ts` — public, v1, and MCP source catalog serialization contracts
- `tests/api/source-catalog-source.test.ts` — source routes and OpenAPI stay wired to the shared source catalog module
- `tests/api/public-items.test.ts` — anonymous feed/search item shape, HKR reason stripping, locale-specific event title fields
- `tests/api/item-detail.test.ts` — public/v1 full-detail item route id parsing, item shape, public HKR stripping, and event-aware ETag signal
- `tests/api/item-detail-source.test.ts` — public/v1 item detail routes stay wired to the shared detail parser/query/serializer module
- `tests/api/event-members.test.ts` — shared event-member route param parsing and item shape used by REST + MCP event coverage surfaces
- `tests/api/event-members-source.test.ts` — UI/public/v1 event-member routes stay wired to shared parsing + serialization helpers
- `tests/api/daily-columns.test.ts` — daily-column REST serializers, ETag signals, UTC date windows, and MCP markdown renderer
- `tests/api/daily-columns-source.test.ts` — public daily routes and MCP daily resources stay wired to the shared daily-column module
- `tests/api/collection-requests.test.ts` — shared saved-collection request schemas for admin camelCase bodies and v1 snake_case bodies
- `tests/api/collections-source.test.ts` — admin/v1 collection routes stay wired to shared collection request schemas
- `tests/api/tweak-requests.test.ts` — shared tweak PATCH validation and DB patch construction for browser + bearer surfaces
- `tests/api/tweaks-source.test.ts` — cookie/v1 tweak routes and the client provider stay wired to shared tweak contracts
- `tests/api/mcp-contract-source.test.ts` — MCP feed/search stay wired to the shared v1 item serializer
- `tests/api/v1-saved-source.test.ts` — `/api/v1/saved` stays wired to the shared saved-item serializer and owner-aware collection helper
- `tests/items/collections.test.ts` — saved collection assignment rejects cross-owner collection ids

Run these with `bun test tests/api/public-*.test.ts tests/api/feed-query-*.test.ts tests/api/source-catalog*.test.ts tests/api/item-detail*.test.ts tests/api/event-members*.test.ts tests/api/daily-columns*.test.ts tests/api/collection*.test.ts tests/api/tweak*.test.ts tests/api/mcp-contract-source.test.ts tests/api/v1-saved-source.test.ts tests/items/collections.test.ts`.

## Operational notes

- **Rate limiter is Vercel-instance-local** — buckets don't survive cold starts. Treated as "discourage hammering" not "airtight cap." Real abuse defense lives at the CDN/WAF layer.
- **Field stripping is centralized for feed/search and item-detail surfaces** — `toPublicApiItem` strips HKR reasons for feed/search, while `toPublicItemDetail` strips detail-only LLM internals (`reasoning`, `body_rss`, HKR reasons). If adding a new domain field, update the relevant serializer and OpenAPI schema together.
- **Feed/search query parsing is centralized** — `/api/public/feed`, `/api/public/search`, `/api/v1/feed`, and `/api/v1/search` share `lib/api/feed-query-params.ts`; only public/v1 max limits differ.
- **Feed execution is centralized for public + v1** — `/api/public/feed` and `/api/v1/feed` both call `runFeedQuery`; route files keep only auth/rate-limit/ETag and item serialization while the helper keeps item rows and `total` counts paired.
- **Search execution is centralized for public + v1** — `/api/public/search` and `/api/v1/search` both call `runSearchQuery`; lexical mode counts the full filtered match set for pagination, while semantic mode shares the same source/date/tier filter mapping.
- **Source catalog serialization is centralized** — `/api/public/sources`, `/api/v1/sources`, and MCP `ax_radar_sources` share `lib/api/source-catalog.ts`; public strips operational diagnostics, v1 keeps them, MCP keeps a compact flat shape.
- **Bearer agent item serialization is shared across REST + MCP** — `/api/v1/feed`, `/api/v1/search`, MCP `ax_radar_feed`, and MCP `ax_radar_search` all use `toAgentApiItem`; `/api/v1/saved` extends it via `toSavedAgentApiItem`.
- **Saved collection assignment is owner-aware** — `/api/v1/saved`, MCP `ax_radar_save`, and browser move actions all delegate to `assignSavedItemCollection` so a user cannot attach a save to another user's collection id.
- **Saved collection request validation is shared across auth surfaces** — `/api/admin/collections` accepts browser camelCase bodies while `/api/v1/collections` accepts agent snake_case bodies, but both normalize through `lib/api/collection-requests.ts` before calling `lib/items/collections.ts`.
- **Tweak validation is shared across browser + agent surfaces** — `lib/tweaks.ts` owns site-config option values and defaults, while `/api/tweaks` and `/api/v1/tweaks` both parse PATCH bodies and build DB patches through `lib/api/tweak-requests.ts`.
- **Event-member parsing + serialization is shared across surfaces** — `/api/events/*`, `/api/public/events/*`, and `/api/v1/events/*` parse `cluster_id` + `locale` through `parseEventMemberRouteParams`; those routes and MCP `ax_radar_event_members` all use `toEventMemberApiItems`.
- **Daily-column serialization is centralized across REST, RSS, site pages, and MCP** — `lib/api/daily-columns.ts` owns `newsletters` queries where `kind='daily' AND column_title IS NOT NULL`, public JSON shape, ETag signals, UTC date-window lookup, RSS/page row listing, and MCP markdown rendering. The legacy structured-digest rows (where `headline IS NOT NULL`) ship separately via `/api/feed/newsletter/{locale}/rss.xml`.

## Related

- Original design: [`../AGENT-MCP-PLAN.md`](../AGENT-MCP-PLAN.md) — s9 plan for `/api/v1/*` + MCP server (bearer-gated track, predates public mirror)
- Architecture milestones: [`../architecture/ingestion.md`](../architecture/ingestion.md) § 6 — deviation entry for 2026-05-13 public API
