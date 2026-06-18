# Current Architecture Overview

This is the orientation map for future agents. Runtime source still outranks
this document; if source and docs disagree, update the code path first and fix
the matching current doc in the same change. Start docs navigation from
[`docs/README.md`](../README.md).

Use this file to decide where a change belongs. Use
[`ingestion.md`](./ingestion.md) for ingestion, enrich, scoring, clustering,
cron, AI HOT, and newsletter runtime details. Use
[`../agent-access/README.md`](../agent-access/README.md) for REST, MCP, RSS,
OpenAPI, and public skill surfaces.

## Ownership Map

| Layer | Owns | Should not own |
|---|---|---|
| `app/[locale]/*` | Locale-scoped reader/admin pages, page-level data orchestration, and UI composition. | API contract serialization, route envelopes, enum literals, worker logic. |
| `components/*` | Reusable UI primitives and feature widgets. | Data fetching rules or cross-route business contracts. |
| `app/api/*` | Thin HTTP adapters: auth, rate limit, cache headers, route params, response envelope choice, and static Next route config. | Shared DB queries, repeated serializers, copied `try/catch` server-error branches, duplicated request schemas. |
| `lib/api/*` | Route-neutral request parsing, domain-result helpers, serializers, and shared payload contracts for public REST, bearer v1, MCP, site pages, and RSS consumers. | Surface-specific auth policy that belongs in the route adapter. |
| `lib/rss/*` | RSS metadata, feed construction, XML rendering, headers, and shared feed-family contracts. | Per-page UI decisions or one-off route-local XML string assembly. |
| `lib/types.ts` | Runtime tuples for app/source locales, source kinds/groups/cadences/health, item tiers, feed views, search modes, feedback votes, user roles, iteration statuses, and newsletter labels. | Database-only or route-local enum copies. |
| `db/schema.ts` | Drizzle tables and Postgres enum wiring, reusing runtime tuples where the value set is a cross-surface contract. | Independent literals that should be shared through `lib/types.ts`. |
| `workers/*` | Durable ingestion, normalization, article-body prefetch, enrichment, scoring, clustering, newsletter, and editorial-agent processes. | HTTP envelope behavior or browser UI concerns. |
| `scripts/ops/*` | Local operator mirrors for production cron, backfills, diagnostics, and resumable state. | Divergent copies of worker predicates, cron slugs, or pending-queue rules. |
| `tests/**/*-source.test.ts` | Source-contract checks that keep architectural routing, delegation, and single-source-of-truth invariants from drifting. | Behavioral assertions that need runtime fixtures or DB-backed tests. |

## Change Routing

Public or agent API work starts in the shared contract module first, then fans
out to surface adapters:

1. Put reusable parsing, DB lookup, serializer, or payload decisions in
   `lib/api/*`.
2. Keep `app/api/public/*`, `app/api/v1/*`, and `app/api/mcp/route.ts` focused
   on auth, rate limits, cache/ETag behavior, transport envelopes, and request
   handoff.
3. Update `/openapi.yaml`, `/skill.md`, `docs/agent-access/README.md`, and the
   matching API source-contract tests when the machine contract changes.

Ingestion or cron work starts in the worker helper first:

1. Put queue predicates, claim/update behavior, and sequencing in `workers/*`.
2. Keep `app/api/cron/*/route.ts` as static Next config plus
   `runCronJsonRoute` payload mapping.
3. Keep local operator parity in `scripts/ops/run-cron.ts` and queue visibility
   in `scripts/ops/check-data-state.ts` / `lib/shell/system-stats.ts`.
4. Update [`ingestion.md`](./ingestion.md) and the cron/source-contract tests.

Shared enum or contract work starts in the runtime tuple:

1. Add or change the tuple in `lib/types.ts` or `lib/llm/types.ts`.
2. Reuse it from `db/schema.ts`, request schemas, OpenAPI, skill generation,
   worker predicates, and UI filters.
3. Add a source-contract test instead of relying on visual review to catch
   duplicated literal arrays.

Reader/admin UI work should keep pages orchestration-focused:

1. Load page data in `app/[locale]/*`.
2. Move repeated shells, tables, empty states, controls, and display helpers
   into `components/*` or `lib/shell/*`.
3. Keep compact feature-specific components near the route only when they are
   genuinely private to that view.

## Agent Maintenance Rules

- Read `docs/README.md` before historical plans or handoffs.
- Prefer shared, named contracts over copied literals or route-local helpers.
- Keep route files thin; shared behavior belongs in `lib/api/*`, `lib/rss/*`,
  `workers/*`, or `lib/shell/*`.
- Add or update `tests/**/*-source.test.ts` when the change introduces a new
  routing, delegation, or single-source-of-truth invariant.
- Historical docs can explain why a decision was made, but current behavior
  must be routed through the current docs index.
- Verify with targeted tests plus `bun run verify`, then run `git diff --check`
  before committing.
