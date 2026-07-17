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

The audit covers all 73 App Router entrypoints: 19 pages and 54 route handlers.

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
- Admin usage removes its duplicate selected-window aggregate. Admin policy
  starts policy and chrome reads concurrently. Concurrent public-page proxy
  probes share one pointer HEAD without weakening controlled-503 behavior.

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
