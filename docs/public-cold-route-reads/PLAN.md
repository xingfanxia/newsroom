# Public Cold Route Reads — Source Plan

Status: PCR-4 in progress

Branch: `perf/public-cold-route-reads`

Started: 2026-07-16

Source of truth: this file plus runtime code. Historical plans are evidence,
not implementation authority.

## 0. Objective and hard boundaries

Eliminate the 33.7 MB canonical-state aggregation from the normal successful
path of every anonymous route while preserving the current public contracts.
The private/admin/authenticated/write/cron surfaces remain unchanged and may
continue to query Turso. Anonymous routes remain R2-only and must never add a
Turso fallback.

Hard boundaries:

- Do not change `canonicalStateSchema` or migrate database schema/data. Never
  run `db:push`.
- Preserve the complete all-time canonical truth. Do not truncate or split
  truth by age; only add content-addressed derived route/id/page/time segments.
- No large singleton derived blob that is rewritten for one item change.
- Every read is pinned to one immutable release. Fallback remains
  active → previous → process last-known-good. Pointer advancement remains the
  final conditional write.
- Publisher planning must reject more than 500 total writes before uploading
  any artifact; steady-state work remains proportional to changed entities.
- `readCanonicalState()` is a legacy-release or controlled-failure fallback
  only. A valid release containing the new artifact family must not call it.
- Preserve the response envelope, fields, ordering, pagination, locale,
  weak-ETag family, errors, and item body behavior.
- Never edit or stage `docs/reports/r2-public-read/**` in this work.
- Tests are invoked only through `bun run test`.

The rejected designs from `docs/snapshot-body-split/PLAN.md` remain rejected:
one large `views/query-index` blob, pre-rendering every item detail, age-based
hot/archive truth truncation, public Turso/cache reads, and a migration rule
that makes legacy fallback impossible.

## 1. Evidence at start

The branch starts at `origin/main` commit `8e5dee5`. The live pointer captured
read-only on 2026-07-16 was:

- active release `r1022-555fe5fe2c8c28184327`, watermark 1022;
- previous release `r1011-9f06362d2a7aea060779`;
- 473 manifest artifacts;
- canonical `state/*`: 33,748,096 bytes;
- `bodies/*`: 62,691,531 bytes;
- existing `views/*`: 8,167,586 bytes.

Exact public response bodies and headers for feed (default and today), lexical
search, item 44779, event 49175 (public and legacy envelopes), sources, active
sources, and main RSS were captured outside the repository under
`/tmp/newsroom-pcr-baseline/`. They are comparison inputs, not committed
artifacts. The observed response sizes were 42.9 KB default feed, 22.6 KB
search, 1.4 KB item, 659 B public event, 640 B legacy event, 21.9 KB sources,
5.4 KB active sources, and 129.7 KB RSS.

A read-only projection over the live 8,892 items, 475 events, and 55 sources
measured the proposed shapes before schema work: 8,104 lead/singleton feed rows
encode to 9.69 MiB with only feed/filter/serialization facts; the lexical
match/filter/sort rows encode to 8.00 MiB total. Thirty-two lexical ID buckets
top out at 282 KB. Feed rows span 37 UTC months; month plus bounded sub-bucket
segmentation keeps individual rewrites bounded while the migration artifact
count remains below the 500-write ceiling. These are projections, not shipped
acceptance measurements, and will be re-measured from built artifacts.

PCR-2 re-read the naturally advanced live release
`r1026-ec8bc48c81279270bf22` to validate the direct-read budget against real
descriptors. Pointer and manifest are 514 B and 148,177 B. Item 44779 (no
event) needs three content artifacts and totals 848,877 B across five R2
objects including pointer/manifest. Event-backed item 44598 needs four content
artifacts and totals 908,630 B across six objects. Event 49175 has two members
in two distinct item buckets; it needs four content artifacts and totals
687,825 B across six objects. These pre-deploy descriptor sums prove the shape
fits the item byte/object target; PCR-6 must still measure deployed application
telemetry and true-cold latency.

PCR-2 now serves item detail and both anonymous event-member envelopes through
one release-scoped transaction. Successful event-backed item reads are exactly
six HTTP object requests (pointer, active manifest, item/body/source/event);
successful two-bucket event reads are also six. Route tests delete an unrelated
canonical artifact while these direct reads succeed, so a hidden full-state
aggregation cannot pass. Exact serializer/ETag parity, legacy fallback,
active→previous→warm-LKG behavior, all cross-artifact consistency failures,
valid empty shards, corrupt/missing dependencies, and controlled terminal 503s
are covered. The first independent review found one Low test-coverage gap; it
was fully resolved, and the second review was clean.

PCR-3 publishes compact route rows in UTC publication month × four stable ID
buckets, a complete directory, and bounded default artifacts for both locales.
The default API path reads exactly pointer + active manifest + one default
artifact; filtered and all-time pagination reads only the directory and
intersecting compact segments. Date/range selection conservatively loads whole
intersecting months before exact row filtering, so directory range metadata
cannot silently omit history. Legacy releases retain release-pinned canonical
fallback; corrupt active default/directory/segment artifacts retry the complete
operation on previous, then warm LKG, and terminal corruption returns 503.

The same builder was measured read-only against live release
`r1036-c5325fdf281f80fb9e6d` (8,896 items, 475 events, 55 sources): 128 segments
total 9,737,295 B, the largest is 857,319 B, the directory is 21,869 B, and the
zh/en defaults are 40,902 B / 43,331 B. A zero-change legacy release migrates
the family through the normal pointer-last publisher under the 500-write
preflight. In the incremental fixture, one historical item changes exactly one
segment while the other six feed artifacts reuse their SHA. The first review
found one Medium directory-integrity gap; path/month/bucket, uniqueness and
ordered bounds validation plus publisher/runtime regression tests resolved it,
and the second review was clean.

The baseline request set was release-tied by fetching `current.json`, then its
active manifest, before the public responses. Capture form was
`/usr/bin/curl -fsS -D <name>.headers '<url>' -o <name>.body`, followed by
`/sbin/sha256sum` on both files. All responses below were HTTP 200:

| Name and exact URL | Body SHA-256 | Header SHA-256 | Stable contract header |
|---|---|---|---|
| pointer `https://content.ax0x.ai/newsroom/v1/current.json` | `1b9cf05596fd7b4080c3067d3f12d66f6d211a1451ce020b71c3dae9771a36bd` | — | active manifest below |
| active manifest `https://content.ax0x.ai/newsroom/v1/releases/r1022-555fe5fe2c8c28184327/manifest.json` | `adc2f86521a99b928825d9db7782aaeeeda5d1af1057447b5806e5742b47d179` | — | equals pointer manifest SHA |
| feed `https://news.ax0x.ai/api/public/feed` | `55cebfc08afebd76b7ba2067c1a39a069ce4db1081afba0bc16ee8644729738b` | `ec3457661f0dc04b8542935e275689f61df8331b05c682e6c7ee225c645949a4` | `W/"public-feed-273a353d8585bfd5"` |
| today feed `https://news.ax0x.ai/api/public/feed?tier=featured&view=today` | `4c1f74268949bc55ff296bf0afb1c241043e087b7f05a7622dc5d7acb20bd21c` | `250a1623fe47444d54a5f7998d02bbe5bc28da72311baf1a48dce2bb5da6adef` | `W/"public-feed-085ccb5d9e3879ed"` |
| search `https://news.ax0x.ai/api/public/search?q=OpenAI` | `5c3303f17220e29b70fe55a2974e6344280e9979adf4f48276d32dd1d5a27261` | `bacaa4dbf21ff8bb2b2ece581b1ca4f0ed257b6c29511b8a72b02fb2eca5d076` | `W/"public-search-a721200243d99e33"` |
| item `https://news.ax0x.ai/api/public/items/44779` | `79b10fc0a5e4ab31d855dd783e253d10ea440ef80126213b1f070a5655a9ccdf` | `8077e7578353d5b69d4b2d184dd463a45feb5c439a28e5eb19e6f6e1c46bd66a` | `W/"public-item-f56e9e31eadad907"` |
| event `https://news.ax0x.ai/api/public/events/49175/members?locale=en` | `6fc861c1a1471219d526cb36ca8623b4a24d2487bad66eb167b00e48f1873b83` | `22774d43916c8064684cb12911aa6bc19d9101a42d530dc5e517449f2e59ed3c` | `W/"public-event-81f0858573367d19"` |
| legacy event `https://news.ax0x.ai/api/events/49175/members?locale=en` | `0d3ce6e14d00e9a5e4f84ca6b524f4f89792e3fe117987907c2a48e666da2e94` | `ec1c0aa4b03b7447a976c1f6fc43970b0697a5a41338883e297f3cbf0ac12ba2` | `application/json` |
| sources `https://news.ax0x.ai/api/public/sources` | `0dcd649def21168e64f87a575712047d3a740d7ba5697f5822dcacf47d7c698a` | `fa8dcc897b09933f7348b13f322e09481db5932cf359d2f5d5093562427458fc` | `W/"public-sources-50975c6330cb4e85"` |
| active sources `https://news.ax0x.ai/api/sources/active` | `c0b943767a00a0f6a453f2ed840dbb41d25b07fc951209cecb2d3d7310f30b63` | `831562869e4d1469b4f660fc5ebc61b4a8d96415fc3f35cfdd3b7c8c572b0fa9` | `application/json` |
| RSS `https://news.ax0x.ai/api/feed/en/rss.xml` | `4f53ebdc6cfe5209f9ade5c834fed8040a9b81c4a76e15935046e550a45c004f` | `2ca8538c31e745fb7d2d2ce989688892e6dbd1e502fc73791b25d775ff5791f0` | `application/rss+xml`, max-age 600 |

Next 16.2.4 local documentation confirms that Route Handlers are not cached by
default and server `fetch` memoization does not apply to Route Handlers. The
current handlers are `force-dynamic`; cold performance therefore has to come
from bounded R2 reads and parsing, not an assumed framework warm cache.

## 2. Complete anonymous-read inventory

The authoritative serving inventory currently contains 11 snapshot pages and
13 snapshot routes, plus seven static-public entries. Direct and transitive
full-state paths found before implementation are:

| Consumer | Normal fast path today | Full-state path to remove from new releases |
|---|---|---|
| `/api/public/feed` | none | `http.ts` → `readPublicSnapshot()` |
| `/api/public/search` lexical | none | `http.ts` → `readPublicSnapshot()` |
| `/api/public/items/[id]` | body shard only after lookup | lookup first aggregates all `state/*` |
| public + legacy event members | none | both route handlers call `readPublicSnapshot()` |
| `/api/public/sources` | `state/sources` singleton | none on success; retain release fallback |
| `/api/sources/active` | none | aggregates all state for one source filter |
| daily/latest/date/index APIs | none | aggregate all state for newsletters/items |
| main/newsletter/legacy RSS | process XML cache after first render | first render aggregates all state |
| shell chrome | 60 s Next cache | cache miss aggregates all state |
| home/all/curated/podcast/x/daily/agents pages | materialized defaults | non-default/missing-view fallback aggregates all state |
| `/[locale]/sources` | `views/sources` | missing/corrupt-view fallback aggregates all state |
| podcast detail | materialized 16 buckets | missing entry fallback aggregates all state |

Static public entries do not load canonical state. Admin, saved, bearer v1/MCP,
semantic search, feedback/write, and cron/publisher entrypoints are outside this
anonymous optimization boundary and retain their existing Turso behavior.

## 3. Chosen artifact/read architecture

### 3.1 Release-scoped reader transaction

Add one reader primitive that executes a dependent multi-artifact operation
against a single resolved release. It tries the active release, then previous,
then a warm last-known-good release. Every logical artifact read inside the
operation uses that release's manifest without re-reading `current.json`.
Legacy fallback, when necessary, aggregates canonical state from that same
release rather than starting an independent pointer transaction.

The primitive is proven with corrupt-active, previous, LKG, missing optional,
required, and cross-pointer-flip tests before route conversion.

### 3.2 Direct entity reads

- Item: one `state/items/<id bucket>` shard, optional aligned body shard,
  `state/sources`, and only the referenced `state/events/<event bucket>`.
- Event members: one event shard, `state/sources`, then only the distinct item
  buckets named by `memberItemIds`.
- Sources/active sources: only `state/sources`.

These reuse canonical shards; they do not duplicate canonical truth or add
publisher writes.

### 3.3 Feed segments

Publish a route-shaped default first-page artifact for each locale. Publish
compact time-segmented feed candidate artifacts for arbitrary filters,
pagination, and all-time results. A date-bounded query selects only intersecting
segments; an unbounded query may scan compact derived segments, never canonical
state. Candidate rows contain only fields required for filtering, stable sort,
and public feed serialization. Segments are independently content-addressed;
one item change rewrites its affected segment, plus bounded event/source
dependents, rather than one global blob.

The concrete partition is UTC publication month × four stable ID buckets. The
live projection produces 128 non-empty segments across 37 months; the largest
compact segment is 899,543 bytes. Empty month/bucket combinations do not get a
descriptor. A small segment-directory artifact names the complete all-time
set, so readers never infer history from a hard-coded date range.

The default artifact is evaluated at request time only for time-sensitive
derived booleans so contract behavior is not frozen at publication time.

### 3.4 Lexical search index

Publish a compact incremental sharded lexical index containing normalized
title/summary/event-title search text plus the minimal filter/sort facts and
entity IDs. It contains no bodies or unused canonical fields. Search scans the
small index shards, filters and ranks exact substring matches, then reads only
the canonical item/event/source buckets required for the selected page. Index
shards are independently rewritten; event/source changes explicitly fan out to
the bounded affected index shards. The measured aggregate target is ≤12 MB.

### 3.5 Small singleton and route artifacts

Materialize or directly derive release-pinned artifacts for daily APIs, RSS,
shell chrome, and active sources. Reuse existing page views for default page
paths. Non-default page variants read compact feed/time segments; a valid new
release never falls back to canonical aggregation merely because a filter is
non-default. Legacy releases retain existing behavior.

## 4. Contract/parity matrix

Each row is tested against the unchanged canonical implementation using the
same fixture state and `nowMs`, plus exact production baselines where stable.

| Surface | Required cases |
|---|---|
| Feed | defaults, tier/view, locale, date/date range, source id/group/kind, curated/tag include/exclude, limit/offset including zero and deep page, ordering/totals, invalid query, 304 |
| Search | zh/en/raw/event-title substrings, ASCII case fold, `%`/`_` LIKE semantics, tier/source/date filters, offset/limit/total, semantic 422 before any read, invalid query, 304 |
| Item | invalid ID, unknown ID, item without event/body, split body, event detail, missing source/event corruption, active→previous→LKG, 304 |
| Event | invalid ID/locale, unknown event empty 200, multi-bucket members, order, public vs legacy envelope, fallback, 304 |
| Remaining anonymous | daily latest/date/index, sources/active, all RSS variants, shell chrome, every page default and non-default fixture route, poison-Turso GET/HEAD/RSC inventory |

For a manifest containing the new required artifact family, tests inject a
throwing/spying canonical loader and must still pass. A manifest predating the
family must produce parity through the release-pinned legacy fallback.

## 5. Publisher invariants and budgets

- Content objects are uploaded and hash-validated before manifest upload;
  pointer CAS remains last.
- The manifest is the release capability set. New readers choose the new path
  only when the complete required family for that operation is present.
- The production migration emits the complete new family within 500 total
  writes. The count is asserted before the first artifact upload.
- Incremental item changes touch their canonical slim/body buckets and only
  affected feed/search segments. Event changes touch the event shard and
  segments containing its members. Source changes touch the singleton and
  segments containing that source's items. Unrelated descriptor hashes are
  reused.
- Publisher tests report changed/reused artifacts and prove no delete-all
  rebuild of a large singleton.

The 473 descriptors in the starting manifest are reused references, not 473
new writes. The concrete production-migration allocation is:

| Artifact/write class | Captured-release migration | Steady item | Steady event | Steady source |
|---|---:|---:|---:|---:|
| month × 4 feed segments | 128 | 1 | 128 | 128 |
| feed segment directory | 1 | 1 | 0 | 0 |
| 32 lexical ID shards | 32 | 1 | 32 | 32 |
| locale default-feed artifacts | 2 | 2 | 2 | 2 |
| shell chrome singleton | 1 | 0 | 0 | 1 |
| daily/RSS/active-sources additions | 0 | 0 | 0 | 0 |
| changed canonical slim/body/source/event | 0 on no-change migration | 2 | 1 | 1 |
| existing materialized page artifacts (conservative) | 30 | 30 | 30 | 30 |
| manifest + pointer CAS + receipt | 3 | 3 | 3 | 3 |
| **worst total** | **197** | **40** | **196** | **197** |

Event/source rows use the conservative maximum fanout across every feed and
lexical bucket; observed fanout should be lower. The migration's 128 segment
writes are the exact non-empty count projected from the captured release, not
the partition's theoretical count: 37 observed months × four buckets allows up
to 148 descriptors. Only non-empty segments are emitted, and a later item in a
previously empty month/bucket writes one segment plus the directory. Daily and
RSS reuse the existing daily views/newsletter shards and feed segments; active
sources reads `state/sources`, so those closures add no artifact family.
PCR-3/4 tests will construct these maxima independently, prove the 500-write
preflight runs before artifact upload, and prove unrelated SHA reuse on the
next tick. A hypothetical new
greenfield bootstrap containing both the existing 473-artifact layout and this
family would require staged immutable uploads before its first pointer and is
not silently forced through the current one-run bootstrap; production already
has a valid active release, so this goal's authorized path is the ≤197-write
incremental migration above.

## 6. Phases and commit ledger

Every phase follows red → green, then independent multi-round review. All
findings, including low severity, are resolved before one conventional commit;
this ledger is updated in that same commit.

| Phase | Scope | Status | Commit/evidence |
|---|---|---|---|
| PCR-1 | inventory, production baseline, exact contracts, release-scoped reader primitive | done | this phase commit; 23 reader tests; reviewer rounds 1–3 clean |
| PCR-2 | release-pinned item and both event-member routes | done | this phase commit; 55 focused tests; typecheck/lint clean; reviewer rounds 1–2 clean |
| PCR-3 | compact segmented feed artifacts, default first page, publisher incrementality | done | this phase commit; 88 related tests; live default 43,331 B max; reviewer rounds 1–2 clean |
| PCR-4 | compact sharded lexical index and hit hydration | in progress | pending |
| PCR-5 | daily, sources/active, RSS, shell, page variants; static/runtime no-full-state verifier | pending | pending |
| PCR-6 | full verification, final review, PR/CI/merge/deploy, true-cold and admin evidence, closeout PR | pending | pending |

## 7. Verification and production acceptance

Focused tests run during each phase. Before PR: `bun run
verify:public-boundary`, then one unchanged-diff `bun run verify`; the final log
must contain the repository's exact success sentinel. No production command is
used to substitute for local proof.

Artifact/read targets on the deployed release:

- item detail ≤1.5 MB and ≤6 R2 artifacts;
- event reads scale with distinct member item buckets;
- default feed ≤500 KB;
- lexical search index ≤12 MB (measure, explain, and continue optimizing if it
  initially exceeds the line);
- three adjacent warm runs per route <0.5 s.

True-cold E2E evidence uses a fresh Vercel deployment/instance signal or Vercel
cold-start telemetry, never a cache-busting query parameter. It records
platform scheduling separately from application R2 fetch/hash/parse/serialize
time. Across sufficient fresh instances, feed/item/event/sources p95 must be
<2 s and search p95 <3 s. Admin pages receive a separate non-regression probe
showing they still query Turso normally and are not coupled to public snapshot
hydration.

After CI is green, the existing authorization permits merge and deployment
without another approval prompt. Production publication remains pointer-last
and ≤500 writes. A closeout PR records deployment, release, artifact sizes/read
counts, warm samples, true-cold samples and telemetry proof, parity results,
admin non-regression, rollback readiness, and any residual limitations.
