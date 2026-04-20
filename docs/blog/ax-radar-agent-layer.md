# Reference — AX Radar's Agent Layer (s9 ship)

**Audience:** the blog agent writing the follow-up piece. The prior article
covered AX Radar itself (the operator-facing curated AI-news feed). This
post covers what got added in session 9 (2026-04-20): the agent-facing
layer that lets Claude (or any tool-using LLM) read, search, and mutate
the radar directly.

This doc is a quote-sheet + decision log, not prose. Pull what you need.

---

## One-line framing

> In session 9 we stopped treating AX Radar as a GUI-only product and
> started treating it as a data source — shipping an HTTP API, an MCP
> server, and a Claude Code skill so that agents could ask "what's on
> the radar today?" the same way a human would click through the web UI.

---

## The before / after contrast

**Before s9:** AX Radar existed as a Next.js app. The operator logged
into `news.ax0x.ai`, scanned the curated feed, clicked into items for
the editor's take, and saved anything worth coming back to. Every
interaction was mediated by the browser.

**After s9:** the same feed is a first-class tool surface for LLMs.
Claude Desktop (or Cursor, or `claude` CLI) can auto-discover the radar
via MCP, ask questions like *"brief me on today's featured items"* or
*"find anything about agentic coding in the last week"*, and get
structured data back — without anyone writing glue code.

---

## The architecture decision: two surfaces, not one

The ship builds **both** an HTTP API *and* an MCP server — a deliberate
choice, not a case of building-it-twice.

**Why HTTP API (`/api/v1/*`):** any LLM with tool-use (OpenAI function
calling, Gemini tools, custom agent runtimes like n8n or LangChain) can
hit a REST endpoint. Some of those runtimes don't speak MCP yet.

**Why MCP (`/api/mcp`):** Claude Desktop, Cursor, and `claude-code`
auto-discover MCP servers from a config block. The operator pastes one
JSON snippet into `claude_desktop_config.json` and the tools appear — no
SDK install, no glue code.

**The MCP layer is a thin adapter.** It re-uses the same Postgres
queries the /api/v1 routes call. No translation logic, no duplicated
business rules. If you change how the radar scores items, both surfaces
see it at once.

Pullquote candidate:

> Two thin shims beat one monolithic integration. MCP is the easy path
> for Claude Desktop; the HTTP API is there for everyone else.

---

## What actually ships

### HTTP API — 8 endpoints

| Path | Method | Purpose |
|---|---|---|
| `/api/v1/feed` | GET | Browse curated items with filters |
| `/api/v1/items/:id` | GET | Full detail + bilingual commentary + transcript |
| `/api/v1/sources` | GET | 59-source catalog + live health |
| `/api/v1/search` | GET | Lexical **or** semantic search |
| `/api/v1/saved` | GET, POST | List bookmarks / toggle save |
| `/api/v1/collections` | GET, POST, PATCH, DELETE | Named bookmark folders |
| `/api/v1/tweaks` | GET, PATCH | User prefs + watchlist terms |
| `/api/v1/usage/summary` | GET | LLM spend + token mix |

### MCP server — 7 tools + 1 resource

At `/api/mcp`. Tools registered: `ax_radar_feed`, `ax_radar_get_item`,
`ax_radar_search`, `ax_radar_sources`, `ax_radar_save`,
`ax_radar_collections_list`, `ax_radar_usage`. Resource: `ax-radar://today`
which renders today's featured items as a pre-formatted markdown briefing.

### Claude Code skill

At `~/.claude/skills/ax-radar/SKILL.md`. The skill *description* is
tuned so that phrases like *"brief me on the radar"* or *"save this for
me"* auto-trigger it. The skill body is pure domain knowledge: what
HKR means, how tier semantics work, when to use lexical vs semantic
search, setup instructions for three different MCP clients, and
guardrails (don't blast the feed into the transcript, don't save
speculatively, etc).

Pullquote candidate:

> Without the skill, a plain MCP hookup means the agent sees
> `importance: 72` but doesn't know if that's high or low. The skill
> layer is where domain knowledge lives.

---

## Design decisions worth writing about

### 1. sha256 token hashing, not bcrypt

Bearer tokens are 32 random bytes (256 bits of entropy from
`crypto.randomBytes`). We store only `sha256(token)` in a unique-indexed
`api_tokens.token_hash` column.

The usual reflex is to reach for bcrypt. For *human passwords* bcrypt is
correct — it's deliberately slow so brute-force attacks against
low-entropy passwords become infeasible. But **token entropy is already
256 bits**. You can't brute-force a 256-bit token. Bcrypt's slowness
would just make our per-request lookup linear (`SELECT * FROM tokens`
+ compare each) instead of logarithmic (`SELECT * FROM tokens WHERE
token_hash = $1` — btree index, single hop).

Pullquote candidate:

> Bcrypt is for low-entropy passwords. Tokens are already high-entropy
> by construction, so sha256 is the correct choice — it lets the
> per-request lookup use a unique index instead of scanning the table.

### 2. Streamable HTTP, not SSE

The original plan doc called for `/api/mcp/sse`. We shipped `/api/mcp`
with the MCP SDK's **Streamable HTTP** transport instead — a single
multi-method endpoint (POST for requests, GET for SSE stream, DELETE
for session close). This is the newer MCP transport (spec revision
2025-03-26), and it's a better fit for Vercel Fluid Compute: stateless
mode means no long-lived connections, no session table, no wake-locks
fighting the function timeout.

### 3. Semantic search rides the existing embedding index

No new infrastructure. The enrichment pipeline already embeds every
item via Azure `text-embedding-3-large` into a pgvector halfvec(3072)
column with an HNSW index. For semantic search we embed the query the
same way, then `ORDER BY embedding <#> $q` — negative inner product,
which ranks identically to cosine distance for unit vectors but skips
the renormalization step.

Cost: ~$0.00002 per query (one embed call). Latency on 6.8k items:
**~250ms p50** end-to-end, dominated by the embedding call (~150ms),
with the SQL at ~80ms. Well under the 500ms target.

Pullquote candidate:

> The HNSW index has been sitting in the database since M2 serving the
> dedup clustering pipeline. Exposing it to agent queries was two
> dozen lines of SQL and one embed call per query — the infrastructure
> was already there.

### 4. The skill is where domain knowledge lives

The MCP protocol exposes tool *signatures*. It doesn't tell the agent
what HKR means, or when importance=72 is high vs low, or that YouTube
sources never score as "excluded" (an operator policy decision). Those
semantics live in the skill file, pre-loaded into the agent's context
before any tool call fires. Without the skill, the tools still work but
the agent uses them dumbly.

---

## What a typical session looks like

Operator, in Claude Code: *"brief me on this week's radar"*

1. Skill description matches "brief me on the radar" — auto-loaded into
   context.
2. Skill content tells Claude: use `ax_radar_feed` for "what's
   happening" questions, prefer markdown resources for summaries,
   group by source and highlight items with `has_commentary: true`.
3. Claude calls `tools/call ax_radar_feed {tier: "featured", limit: 30}`
   through the MCP server.
4. MCP server verifies the Bearer token (same token as /api/v1), runs
   `getFeaturedStories` against Postgres, returns 30 items as JSON.
5. Claude calls `resources/read ax-radar://today` for the pre-formatted
   markdown view.
6. Claude summarizes, citing item ids, quoting editor_analysis where
   relevant.

Total time: a few seconds. Operator wrote one sentence. No glue code
existed a week ago.

---

## Numbers to cite

- **Data state at ship:** 6821 items enriched (99.7%), 59 sources
  (43 healthy), $443 LLM spend over 30 days across 68k calls.
- **Ship size:** 2 commits, ~1,600 LOC added, touching ~20 files.
- **Tests:** 14 new integration tests that exercise real route handlers
  against a real Postgres via synthetic `Request` objects (no HTTP
  server, no curl, no mocks).
- **Semantic search perf:** p50 ~250ms end-to-end on the 6.8k-item
  HNSW-indexed column.
- **MCP tool count:** 7 tools + 1 resource registered.
- **Auth:** one token table, Bearer-gated, sha256-hashed, O(log n)
  lookup via unique btree index.

---

## The story beats for the article

A good structure, in rough order:

1. **Reminder of what AX Radar is** (one paragraph, link to prior post).
2. **The problem:** the feed was GUI-only. Tool-using agents couldn't
   reach it, so "brief me on the radar" didn't work unless you
   screenshotted the dashboard.
3. **The ship:** two surfaces (HTTP API + MCP) + a Claude Code skill.
4. **The architectural decisions worth dwelling on:**
   - sha256 vs bcrypt (above)
   - Streamable HTTP vs SSE (above)
   - Why *both* surfaces, not one (above)
   - Semantic search riding the existing pgvector index (above)
   - Skill as the domain-knowledge layer (above)
5. **The experience:** "brief me on this week's radar" now does the
   right thing with no glue code.
6. **What's next:** webhooks (push, not pull), multi-user scoping,
   agent-to-agent integrations where one agent feeds the radar and
   another consumes it.

---

## One-liners the article can lift

- "Two thin shims beat one monolithic integration."
- "MCP tells the agent *what* tools exist. The skill tells it *when*
  and *why* to use them."
- "The HNSW index was already there for clustering. Semantic search
  was ~24 lines of SQL and one embed call per query."
- "sha256 is correct for high-entropy tokens the same way bcrypt is
  correct for low-entropy passwords — they're not substitutes, they
  solve different problems."
- "The ship wasn't about building something new. It was about giving
  the thing we already had a second face."

---

## What NOT to claim (accuracy guardrails)

- **Don't claim "real-time push":** agents pull on demand. Webhooks are
  a future-v2 item, not shipped.
- **Don't claim MCP supports writes unconditionally:** the operator has
  to explicitly give the agent a Bearer token. Tokens can be revoked.
  The `ax_radar_save` tool requires explicit operator intent per the
  skill guardrails — agents shouldn't save speculatively.
- **Don't claim sub-100ms semantic search:** we measure p50 ~250ms.
  Fast, but not sub-100ms.
- **Don't claim "works with any MCP client" without qualification:**
  it's Streamable HTTP (2025-03-26 spec). Older MCP clients that only
  speak stdio will need a stdio adapter.
- **Don't overstate the skill's auto-trigger:** it works when the
  operator asks the radar-ish questions listed in the skill
  description. Out-of-band queries ("write me a poem about AI") won't
  trigger it, which is correct behavior.

---

## Relevant files for agents who want to cite the source

- `app/api/v1/*` — REST endpoint handlers
- `app/api/mcp/route.ts` — MCP server, tool + resource registration
- `lib/auth/api-token.ts` — Bearer verification (sha256 + timing-safe
  compare via the btree unique index)
- `lib/items/semantic-search.ts` — pgvector query builder
- `scripts/ops/mint-api-token.ts` — token lifecycle CLI
- `~/.claude/skills/ax-radar/SKILL.md` — domain-knowledge layer
- `docs/AGENT-MCP-PLAN.md` — original design + phase-by-phase ship log
- Commits: `d968a29` (Phase 1: auth + read API) and `c7394bc` (Phases
  2–5: writes + semantic + MCP + skill)
