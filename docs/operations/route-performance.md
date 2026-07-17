# Route Performance and Egress Budgets

Status: current runtime contract and audit ledger. Runtime code and production
measurements outrank this document if they conflict.

## Budgets

| Surface | Cold target | Warm target | Response / upstream budget |
|---|---:|---:|---:|
| Anonymous HTML/RSC page | < 3 s | < 500 ms | < 512 KiB decoded response |
| Public/bearer JSON read | < 3 s | < 500 ms | default < 256 KiB; explicit max < 1 MiB |
| Admin page | < 3 s | < 1.5 s | < 256 KiB decoded response |
| One immutable R2 artifact | — | — | < 1 MiB decoded unless documented below |
| Remote worker response | endpoint timeout | — | byte cap required even without `Content-Length` |
| JSON mutation request | — | — | 64 KiB default; MCP transport 256 KiB |

Every list query needs a limit, aggregation, pagination boundary, or a named
small operational-cardinality invariant. A timeout must remain active through
response-body consumption, not only until headers arrive.

## Entrypoint coverage

The dated 2026-07-16 audit covered 73 App Router entrypoints: 19 pages and 54
route handlers. The current page/GET/HEAD count is code-owned by
`lib/public-content/entrypoints.ts`; do not copy the dated count forward.
`tests/tooling/public-entrypoints-inventory.test.ts` fails closed when a page or
read route is added without a classification.

| Family | Entrypoints / ownership | Bound |
|---|---|---|
| Snapshot pages | `/:locale`, `/all`, `/curated`, `/sources`, `/podcasts`, `/podcasts/:id`, `/x-monitor`, `/daily`, `/daily/:date`, `/agents`, `/newsletter` | R2 only; home/materialized first page; archive pages 50 cards |
| Private pages | `/saved`, `/admin/{iterations,newsletter,policy,system,usage,users}`, `/login` | Turso allowed; primary data and admin chrome run concurrently where independent |
| Public JSON | `/api/public/{feed,search,sources,items/:id,events/:id/members,daily,daily/:date,dailies}` and legacy event members | R2 only; list maxima 100/50/180; event fan-out max 200 |
| RSS/static machine docs | `/api/feed/*`, `/api/rss/*`, `/openapi.yaml`, `/skill.md` | 50-item RSS families or static generated text; release-keyed RSS memoization |
| Bearer/MCP reads | `/api/v1/{feed,search,sources,items/:id,events/:id/members,saved,collections,tweaks,usage/summary}`, `/api/mcp` | feed 200 REST / 100 MCP; search 100; saved 200; MCP body 256 KiB |
| Session/admin mutations | admin auth/collections/iterations/policy, feedback, newsletter, saved export, tweaks | shared bounded JSON parser; saved export is an explicit attachment capped at 500 items |
| Cron routes | fetch buckets, normalize, body, enrich, commentary, score, cluster, newsletters, publish/rollback | authenticated; worker batch caps; reports return counters and bounded error stubs |

Operational catalogs (`sources`, one user's named collections, and newsletter
recipients) are intentionally complete sets. Their rows are narrow and their
cardinality is controlled by operator/user actions. Newsletter delivery is the
only intentionally cardinality-proportional route; Resend chunks and the send
ledger make the external work bounded per request chunk and idempotent.

## New endpoint / route runbook

Use this checklist for every new page or route handler and whenever an existing
route gains a method, data source, or materially larger response. The author of
the route owns the checklist and its evidence through the first deployment.

### 1. Classify the surface

- If the source is a page, `GET`, or `HEAD`, add it to
  `lib/public-content/entrypoints.ts` with its exact app path, request pathname,
  source, and access class; add a build-module override only when the derived
  path is not correct. Update the frozen totals and access-class counts in
  `tests/tooling/public-entrypoints-inventory.test.ts`. Source and build
  discovery reject an unclassified reader.
- Choose `snapshot-only` for anonymous dynamic reads, `static-public` for
  generated/static content, `private-authenticated` for session or bearer
  reads, and `operator-authenticated` for admin/cron operations.
- A POST-only route is intentionally absent from the GET/HEAD serving
  inventory. It still needs an explicit access class in its route-family test,
  bounded input and work, and an update to the family table above if it creates
  a new family.

### 2. Declare the contract before implementation

Copy this table into the change description and replace every value. `N/A` is
acceptable only with a reason; a mutation still needs an end-to-end timeout.

| Field | Required decision |
|---|---|
| Route / methods | Exact pathname, methods, and page/API/cron family |
| Owner / access class | Owning route family and one of the four access classes |
| Data source | R2 artifact(s), static bundle, Turso query, or named upstream |
| Query / fan-out bound | Limit, page size, batch size, shard count, or named small-cardinality invariant |
| Cold target | Budget from the table above or a stricter route-specific target |
| Warm target | Budget from the table above or a stricter route-specific target |
| Decoded response cap | Maximum bytes returned to the caller |
| Upstream-fetch cap | Maximum decoded bytes per upstream response and maximum fetch count |
| Cache policy | Key, scope, TTL/revalidation, and invalidation owner |
| Auth / side effects | Authentication, authorization, rate limit, idempotency, and write behavior |
| Failure contract | Timeout, controlled status/error body, and whether stale data is allowed |
| Rollback condition | Measurable breach that reverts or disables the route |

### 3. Design the smallest cold read

- Anonymous dynamic routes are R2-only with no Turso fallback. The initial
  screen reads a materialized first page; item detail reads one ID shard; event
  members read only shards hit by the member index; search reads the compact
  lexical index and hydrates only matched item shards. Do not load the full
  historical corpus before serving the first response.
- Admin routes may query Turso directly and must not wait on public snapshot
  state. Use narrow projections, aggregate/covering indexes, one batch for
  independent queries, and concurrent chrome/data reads where dependencies
  allow it.
- Lists require a limit or cursor. Cap search text, offsets, IDs, batch size,
  shard fan-out, request bodies, upstream bodies, and returned error details.
  Avoid N+1 reads by batching IDs and hydrating only the selected page/hits.
- A new R2 format needs a version/feature marker, compatibility decision, and
  publisher verification before readers depend on it.

### 4. Verify before merge

Run the smallest route-family tests first, then the applicable boundary gate:

```sh
bun test tests/tooling/public-entrypoints-inventory.test.ts
bun test tests/docs/route-performance-runbook.test.ts
bun run verify:public-boundary
bun run verify
```

`verify:public-boundary` is required for anonymous/public snapshot changes.
Run `bun run verify` once on the final relevant diff for a broad change or
release gate. For a narrow route change, add or update a focused test covering
auth, input/query limits, response projection, failure behavior, and data-source
ownership.

### 5. Measure and ship

For safe reads, exercise preview first and then the deployed route with one
first-request sample followed by two immediate warm samples. Record status,
decoded response bytes, total time, cache headers/state, deployment commit, data
source, and query/fan-out. Treat a first-request budget breach or two
consecutive warm samples over budget as a regression that needs remediation or
an explicitly documented exception before release.

Do not invoke a production mutation or cron merely to measure it. Verify writes
with static/focused tests and an isolated preview or fixture unless the operator
has separately authorized the production action. After an R2 reader change,
confirm the deployed release has the required marker and artifacts before
judging route latency.

The route is done only when it is classified, bounded, focused-test covered,
measured where safe, documented in the correct family, and has a rollback
condition.

## 2026-07-16 baseline and changes

Production baseline before this audit:

- `/en/all?offset=1`: 1,177,585 bytes and 2.5–2.9 s.
- `/en/curated`: 1,132,288 bytes and 0.57–1.38 s.
- `/en/x-monitor`: 751,505 bytes and 0.41–1.61 s.
- `/en/podcasts`: 529,446 bytes and about 0.45 s.
- Cold-ish public feed/item/search: 1.44/1.65/1.96 s; warm about 0.30–0.37 s.
- Admin system/usage were the heaviest pages: about 1.9/1.5 s first request and
  0.78/1.29 s warm; other admin pages were 0.15–0.35 s warm.

Implemented controls:

- All archive/date pages now paginate at 50 cards. On the then-current
  production corpus, regenerated materialized artifacts shrink 36–77%:
  `all` 312–340 KiB to 73–78 KiB, `curated` 330–360 KiB to 79–88 KiB,
  `podcasts` 159–188 KiB to 102–119 KiB, and `x-monitor` 144–274 KiB to
  92–173 KiB.
- Lexical index v2 removes duplicated/full summary payload while retaining
  titles and 64-character per-locale summary excerpts. The production corpus
  falls from 8,347,553 to 4,012,850 decoded bytes and from about 3,664,532 to
  1,739,997 gzip bytes (about 52% less). Hits still hydrate only matching item
  shards.
- Score-backfill selection is pinned to its slim partial index and performs a
  second narrow projection; enrich and commentary no longer read embedding or
  other unused item columns.
- Remote RSS/Jina/X/AIHOT/pricing/snapshot reads enforce streaming byte caps;
  timeouts cover body reads. All JSON mutation routes share a 64 KiB cap.
- Admin usage is served by a trigger-maintained UTC-day Turso rollup and one
  libSQL read batch. Exact rolling week/month windows scan only their partial
  boundary day from the raw append-only ledger instead of rescanning 371k+
  calls; install/backfill with `bun run db:migrate:usage-rollups -- --apply`.
  Admin policy starts policy and chrome reads concurrently. Concurrent
  public-page proxy probes share one pointer HEAD without weakening
  controlled-503 behavior.

Largest accepted immutable artifacts in the audited production release were
below 1 MiB: item body shards at about 682 KiB, feed segments at about 857 KiB,
daily view at about 583 KiB, and podcast-detail buckets at 195–465 KiB. They are
content-addressed, Cloudflare-compressed, cached, and never fetched as a family
for ordinary home/feed/item-detail requests.

## Verification

The release gate is:

1. `bun run verify` on the final diff.
2. Preview/production safe-GET matrix recording status, decoded bytes, total
   time, cache state, and first/warm request for every page/read family.
3. Static checks for mutation and cron handlers; do not invoke production
   writes merely to measure latency.
4. Confirm the new R2 release contains compact lexical v2 and 50-card
   materialized views before judging production page results.

## Maintenance

The route author owns new-route evidence; the route-family maintainer owns the
budget after handoff; the release operator owns deployed safe-read probes. Use
the following cadence so the runbook remains a live contract.

| When | Required maintenance | Durable evidence |
|---|---|---|
| Every route change | Re-run inventory and focused tests; update classification, family bounds, budget contract, and frozen inventory counts when applicable | Test output plus change description |
| After every deployment that changes a route | Run the first/warm safe-read samples, compare to its declared contract, and confirm the deployed commit/artifact marker | Deployment receipt or a dated report |
| Monthly | Sample one representative from each active read family, review response/artifact sizes and upstream/query fan-out, and remove or revise stale exceptions | Summary under `docs/reports/route-performance/` |
| Triggered re-audit | Re-audit the affected family and its shared artifacts/queries; do not wait for the monthly check | Dated regression report linked from this document |

A triggered re-audit is required when any of these occurs:

- a first-request sample breaches its cold target or two consecutive warm
  samples breach its warm target;
- corpus size, traffic, query cardinality, or an artifact/response size doubles
  from its last audited baseline;
- a response exceeds its declared cap, an immutable artifact approaches 1 MiB,
  or observability/billing reports an egress or function-duration regression;
- a schema, index, snapshot layout, cache rule, auth boundary, or upstream API
  changes; or
- a list/fan-out bound is raised or a new fallback/data source is introduced.

Keep current budgets and the latest accepted summary in this document. Put raw
probe output and dated investigations under `docs/reports/route-performance/`
instead of growing the runbook indefinitely. Current route membership and
counts always come from runtime source plus the entrypoint inventory, never from
an old audit paragraph.
