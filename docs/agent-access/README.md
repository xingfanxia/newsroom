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
- **`lib/api/public-items.ts`** — shared anonymous feed/search item serializer. It keeps the public `FeedItem` shape aligned across `/api/public/feed` and `/api/public/search`.
- **`lib/api/v1-items.ts`** — shared bearer-gated agent item serializer used by `/api/v1/feed`, `/api/v1/search`, `/api/v1/saved`, and MCP feed/search tools.
- **`lib/api/story-item-fields.ts`** — shared flat Story field helpers used by both anonymous public serializers and bearer-gated `/api/v1/*` serializers, with each surface still owning its HKR exposure policy.
- **`lib/api/event-members.ts`** — shared event-member item serializer used by UI-internal, public, v1, and MCP event-member surfaces.

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
- `tests/api/public-items.test.ts` — anonymous feed/search item shape, HKR reason stripping, locale-specific event title fields
- `tests/api/event-members.test.ts` — shared event-member item shape used by REST + MCP event coverage surfaces
- `tests/api/mcp-contract-source.test.ts` — MCP feed/search stay wired to the shared v1 item serializer
- `tests/api/v1-saved-source.test.ts` — `/api/v1/saved` stays wired to the shared saved-item serializer and owner-aware collection helper
- `tests/items/collections.test.ts` — saved collection assignment rejects cross-owner collection ids

Run these with `bun test tests/api/public-*.test.ts tests/api/event-members.test.ts tests/api/mcp-contract-source.test.ts tests/api/v1-saved-source.test.ts tests/items/collections.test.ts`.

## Operational notes

- **Rate limiter is Vercel-instance-local** — buckets don't survive cold starts. Treated as "discourage hammering" not "airtight cap." Real abuse defense lives at the CDN/WAF layer.
- **Field stripping is centralized for feed/search items** — `toPublicApiItem` strips HKR reasons once and is shared by `/api/public/feed` and `/api/public/search`. Detail endpoints still own their nested payload shape; if adding a new domain field, update the relevant serializer and OpenAPI schema together.
- **Bearer agent item serialization is shared across REST + MCP** — `/api/v1/feed`, `/api/v1/search`, MCP `ax_radar_feed`, and MCP `ax_radar_search` all use `toAgentApiItem`; `/api/v1/saved` extends it via `toSavedAgentApiItem`.
- **Saved collection assignment is owner-aware** — `/api/v1/saved`, MCP `ax_radar_save`, and browser move actions all delegate to `assignSavedItemCollection` so a user cannot attach a save to another user's collection id.
- **Event-member serialization is shared across surfaces** — `/api/events/*`, `/api/public/events/*`, `/api/v1/events/*`, and MCP `ax_radar_event_members` all use `toEventMemberApiItems`.
- **Daily-column endpoints** read from `newsletters` table where `kind='daily' AND column_title IS NOT NULL`. The legacy structured-digest rows (where `headline IS NOT NULL`) ship separately via `/api/feed/newsletter/{locale}/rss.xml`.

## Related

- Original design: [`../AGENT-MCP-PLAN.md`](../AGENT-MCP-PLAN.md) — s9 plan for `/api/v1/*` + MCP server (bearer-gated track, predates public mirror)
- Architecture milestones: [`../architecture/ingestion.md`](../architecture/ingestion.md) § 6 — deviation entry for 2026-05-13 public API
