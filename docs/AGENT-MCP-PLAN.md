# AX Radar — Agent / MCP Integration Plan (s9 design)

Drafted end of session 8 (2026-04-20). The ask: expose AX Radar's feed,
saved collections, commentary, and source health to agents so Claude (and
other tool-using LLMs) can read + write against the radar as if it were a
first-class data source.

## Why two surfaces, not one

Build both in s9:

1. **HTTP API** (`/api/v1/*`) — source of truth. Public REST, Bearer auth.
   Any LLM with tool-use (OpenAI function calling, Gemini, custom agents)
   can hit it.
2. **MCP server** (`/api/mcp/sse` + stdio launcher) — thin adapter over
   the HTTP API. Translates MCP tool invocations → HTTP calls. Claude
   Desktop, Cursor, and `claude-code` auto-discover it via config.

Why not MCP-only: many agent runtimes (n8n, LangChain, custom Python)
don't speak MCP yet. Why not HTTP-only: Claude Desktop's MCP picker is
the easiest path for the operator to wire the radar into a
chat-with-my-data loop. Two thin shims beat one monolithic integration.

---

## Read tools (v1 priority)

All read endpoints are idempotent, cacheable, and bounded. Agent-friendly
response shapes: flat JSON, ISO-8601 dates, no prose in error fields.

### `GET /api/v1/feed`
Query params:
- `tier` — `featured` (default) | `p1` | `all`
- `date` — `YYYY-MM-DD`, optional
- `source_group` — `podcast` | `newsletter` | `vendor-official` | `media` | `research` | `social` | `product`
- `source_kind` — `rss` | `atom` | `x-api` | …
- `date_from`, `date_to` — window (both or neither)
- `limit` — default 40, max 500
- `offset` — default 0
- `locale` — `zh` | `en` (default `en`)

Response:
```json
{
  "items": [{
    "id": "6821",
    "title": "…",
    "summary": "…",
    "publisher": "Dwarkesh Patel",
    "source_id": "dwarkesh-yt",
    "source_group": "podcast",
    "tier": "featured",
    "importance": 72,
    "hkr": { "h": true, "k": true, "r": false, "reasonsEn": {...} },
    "tags": ["agent", "coding", "benchmark"],
    "url": "https://…",
    "published_at": "2026-04-19T01:50:00Z",
    "has_commentary": true
  }],
  "total": 6821,
  "limit": 40,
  "offset": 0
}
```

### `GET /api/v1/items/:id`
Full detail: title, summary (both locales), editor_note, editor_analysis
(multi-paragraph), reasoning, HKR breakdown with per-axis reasons, tags,
full `body_md` transcript (for YT) or article body. This is the "give me
everything you have on this item" endpoint the agent would call after
spotting a hit in `/feed`.

### `GET /api/v1/search`
- `q` — free-text query
- `mode` — `lexical` (default, ILIKE on title+summary) | `semantic`
  (pgvector cosine on `embedding` column; we already have HNSW index
  via `halfvec(3072)`)
- Other filters: same as `/feed`

Semantic mode is the interesting one. Embed `q` via Azure
`text-embedding-3-large`, run `ORDER BY embedding <#> :q` with `LIMIT`.
Cost: 1 embed call per query (~$0.00002), already within normal pipeline
budget. Warm up the HNSW for sub-100ms retrieval on 6k+ items.

### `GET /api/v1/sources`
Returns the 59-source catalog with current health (`status`,
`consecutive_failures`, `last_success_at`, `total_items_count`). Useful
for agents that want to verify coverage before asking a question.

### `GET /api/v1/usage/summary`
Wraps the existing `/admin/usage` data in an agent-readable shape: today
/ 7d / 30d spend, token mix, top-cost tasks. Useful for agents checking
budget before firing large batches.

### `GET /api/v1/saved`
Returns the caller's saved items. Collection + tier filters. Same shape
as `/feed` with a `saved_at` and `collection_id` added.

---

## Write tools (v1 priority)

All write endpoints mutate per caller. Auth is the same Bearer as
read — no separate write scope in v1 (single-user mode). Consider scopes
in v2 if multi-agent sharing becomes relevant.

### `POST /api/v1/saved`
Body: `{ item_id: number, on: boolean, collection_id?: number }`.
Thin wrapper over existing `applyFeedbackToggle({vote: "save"})`. Agents
use this to bookmark hits for the human to review later.

### `POST /api/v1/collections`
Create a named collection. Body: `{ name: string, name_cjk?: string }`.

### `PATCH /api/v1/collections/:id`
Rename, pin, reorder. Same payload shape as `/api/admin/collections`.

### `DELETE /api/v1/collections/:id`
Cascade-reparents saves to inbox (existing `ON DELETE SET NULL` behavior).

### `POST /api/v1/watchlist`
Body: `{ terms: string[] }` — replaces the current list (matches
existing `/api/tweaks` PATCH shape for `watchlist`).

---

## Auth

**Current admin gate**: HMAC-signed cookie via `ADMIN_PASSWORD`. Fine for
browser sessions, wrong for agents.

**v1 API auth**: Bearer tokens in `Authorization: Bearer <token>` header.

- Mint tokens via `/admin/api-tokens` (new admin UI, or CLI-only for v1)
- Store as `api_tokens` table: `id, user_id, token_hash (bcrypt),
  label, last_used_at, created_at, revoked_at`
- Middleware `lib/auth/api-token.ts`: extracts bearer, looks up hash,
  sets `req.user` to the owning admin user
- Reuse admin user everywhere since we're single-user mode

**Token scope**: v1 = full access (single user owns everything). v2 if
we re-introduce multi-user: scope per (user, permission_set).

---

## MCP server design

**Transport**: SSE over HTTPS. Vercel Fluid Compute handles the
long-lived stream well; no separate long-running process needed. Config
at `/api/mcp/sse` (GET for stream, POST for tool calls).

**Tools registered**:
```
ax_radar_feed         → GET /api/v1/feed
ax_radar_get_item     → GET /api/v1/items/:id
ax_radar_search       → GET /api/v1/search
ax_radar_sources      → GET /api/v1/sources
ax_radar_usage        → GET /api/v1/usage/summary
ax_radar_save         → POST /api/v1/saved
ax_radar_collections  → GET /api/v1/collections (+ POST/PATCH/DELETE)
ax_radar_watchlist    → GET /api/v1/tweaks + POST /api/v1/watchlist
```

**Resources registered**:
- `ax-radar://today` — today's curated feed as a single markdown doc
- `ax-radar://item/:id` — item detail as markdown
- `ax-radar://collection/:id` — collection contents as markdown

**Auth**: operator pastes their Bearer token into the MCP client config
(Claude Desktop `claude_desktop_config.json` or equivalent). The SSE
server reads the token from the initial handshake header.

**Library choice**: `@modelcontextprotocol/sdk` (official TypeScript
SDK). Thin wrapper — the whole MCP surface is ~300 LOC because all the
business logic is already in the HTTP handlers.

---

## Claude Code skill

After the MCP server is live, wrap it in a `ax-radar` skill so agents in
`claude-code` get domain context (what HKR means, tier semantics, how
to phrase queries) alongside tool access.

Directory: `~/.claude/skills/ax-radar/`
- `SKILL.md` — description + usage examples + tier/HKR glossary
- `mcp.json` — points the skill at the MCP server so tools auto-load

The skill's value-add is the domain knowledge layer. Without it, a plain
MCP server hookup means the agent sees `importance: 72` but doesn't
know whether that's high or low. The skill says "importance ∈ [0-100],
≥85 = P1, 70-84 = featured, <70 = all (still browseable), tier
'excluded' means scorer dropped it except YT which never excludes".

---

## Rollout order (s9)

Phase 1 — Read API (half a session):
1. `lib/auth/api-token.ts` + `api_tokens` table + migration
2. `/api/v1/feed`, `/api/v1/items/[id]`, `/api/v1/sources`
3. `/api/v1/search` with lexical mode only (semantic later)
4. Integration test that exercises each endpoint end-to-end

Phase 2 — Write API (quarter session):
5. `/api/v1/saved`, `/api/v1/collections/*`, `/api/v1/watchlist`
6. Admin UI for minting API tokens (or a CLI `scripts/ops/mint-api-token.ts`)

Phase 3 — Semantic search (quarter session):
7. Add semantic mode to `/api/v1/search`: embed query + pgvector HNSW
8. Benchmark: cold query p95 target <500ms on current 6.8k-item index

Phase 4 — MCP server (half a session):
9. `/api/mcp/sse` route with `@modelcontextprotocol/sdk`
10. Register all tools + resources
11. Publish installer snippet: `claude_desktop_config.json` block with
    SSE URL + Bearer token placeholder

Phase 5 — Claude Code skill (short):
12. `~/.claude/skills/ax-radar/SKILL.md` with glossary + examples
13. `mcp.json` pointing at the production MCP server
14. Test end-to-end: `claude` asks "brief me on this week's radar"
    → skill autoloads → MCP retrieves → answer with citations

Total estimated effort: ~1 full session if focused.

---

## Open questions for s9

1. **Rate limit on public API**: agents will fire chatty queries. Start
   with 60 req/min per token (simple in-memory sliding window via
   `@vercel/kv` or Upstash Redis), revisit if legitimate use hits it.
2. **Do we expose commentary drafts or only published?** v1 answer:
   only `commentary_at IS NOT NULL`. Agents shouldn't see in-flight
   drafts.
3. **Semantic-search + source filter**: pgvector `ORDER BY` with WHERE
   may bypass HNSW. Benchmark before promising sub-500ms. Fallback: two
   queries (HNSW candidate set of 500, then filter in app).
4. **Webhook emission?** Agents might want push, not pull — "notify me
   when a P1 lands in 'agent' capability tag". Out of v1 scope, but
   reserve `/api/v1/webhooks` path prefix.
