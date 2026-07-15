# R2 Public-Read Goal Acceptance Inventory

Goal version: `r2-public-read-v1-ec57c55fe111`

This inventory is frozen from
`docs/R2-PUBLIC-READ-PLAN-2026-07-14.md`. Only `status` and
`last_verification` may change without an Oracle Change Note in
`loop/STATE.md`.

```yaml
- id: AC-001
  statement: >-
    The default test and verification path is hermetic: it never loads
    production Turso/R2 credentials, real production integration is explicit
    opt-in, and async timeout/failure output cannot be reported as green.
  source: docs/R2-PUBLIC-READ-PLAN-2026-07-14.md#safe-verification-first
  authority: AX plan approval plus docs/HANDOFF.md gate-hygiene evidence
  verifier: bun run verify:r2-public --criterion AC-001
  pass_evidence: >-
    A known production-credential sentinel is rejected, local libSQL/fake-R2
    fixtures pass, and a deliberate async-timeout fixture makes the verifier
    exit nonzero.
  fail_evidence: >-
    package.json currently defines test as `bun test --env-file=.env.local`,
    while docs/HANDOFF.md records production DB access and masked timeout exits.
  status: PASS_PENDING_FINAL
  depends_on: []
  reopen_condition: Any default test command can load production credentials or mask a failure.
  last_verification: >-
    Passed locally 2026-07-14: AC-001 criterion exit 0; hostile Next env-loader
    probe preserved all 28 explicit local/fake controlled values; exit-zero
    failure/timeout and controller deadline were rejected; default test passed
    1198/1198 plus the complete hermetic verify gate with no production
    integration. Focused requested inputs are regular-file allowlisted, and all
    production data prerequisites fail loud rather than returning early. Receipt:
    docs/reports/r2-public-read/ac-001-hermetic-gate-2026-07-14.md.

- id: AC-002
  statement: >-
    Versioned, typed public snapshot contracts and canonical serialization
    publish only explicitly eligible public fields/records and reject unknown
    schema versions or private data.
  source: docs/R2-PUBLIC-READ-PLAN-2026-07-14.md#published-object-contract
  authority: AX plan approval and current public API serializers
  verifier: bun run verify:r2-public --criterion AC-002
  pass_evidence: >-
    Schema/sanitization tests cover eligible, excluded, unenriched, private,
    embedding, raw-body/diagnostic, token, feedback, saved, and user-setting
    sentinels; deterministic fixtures produce stable SHA-256 values.
  fail_evidence: >-
    No public-content persisted schema exists, and the current item-detail path
    does not itself enforce enriched/non-excluded eligibility.
  status: PASS_PENDING_FINAL
  depends_on: [AC-001]
  reopen_condition: A persisted schema changes or a forbidden-field sentinel serializes successfully.
  last_verification: >-
    Passed locally 2026-07-14: strict schema-v1 contracts, forbidden-field and
    unknown-version sentinels, canonical serialization, eligibility, release
    invariants, hash-frozen independent query/RSS parity fixtures, and pure
    query/derivation behavior passed 50/50 tests with 337 assertions across 8
    hermetic suites. Five runtime modules passed the framework/DB/env/I/O source
    boundary under hostile inherited Turso/R2 credential sentinels. Receipts:
    docs/reports/r2-public-read/ac-002-task-5-snapshot-contracts-2026-07-14.md
    and docs/reports/r2-public-read/ac-002-task-6-query-parity-2026-07-14.md.

- id: AC-003
  statement: >-
    The incremental publisher is atomic, concurrent-safe, idempotent, and
    bounded: no-change work is O(1), changed work is O(changed entities), and
    repeating full-corpus scans are impossible.
  source: docs/R2-PUBLIC-READ-PLAN-2026-07-14.md#incremental-publisher-contract
  authority: AX plan approval
  verifier: bun run verify:r2-public --criterion AC-003
  pass_evidence: >-
    Expected-red fault tests prove pointer-last writes, object/manifest checksum
    validation, outbox high-water preservation, failure-without-delete,
    ETag/CAS concurrency, unchanged hash reuse, retry idempotency, and bounded
    SQL plans; publisher telemetry reports candidate/scanned/returned rows.
  fail_evidence: >-
    Publisher, outbox, immutable manifests, and their fault tests do not exist.
  status: PASS_PENDING_FINAL
  depends_on: [AC-001, AC-002]
  reopen_condition: Any publish path can advance a partial release, lose a concurrent change, or rescan the corpus on a no-change tick.
  last_verification: >-
    Passed locally 2026-07-14 via `bun run verify:r2-public --criterion
    AC-003`: 6 hermetic publisher suites, 28 tests and 185 assertions under
    hostile inherited Turso/R2 credential sentinels. Evidence covers outbox
    high-water safety, bounded PK/index plans, one batched event-member query,
    content/manifest readback, pointer-last CAS conflict and ambiguity, ack
    retry, deterministic shard reuse/scale, one-shot bootstrap ledger, exact
    cron cadence, bounded reconciliation and conservative retention. No
    production migration, DB/R2 call, publish or deploy ran.

- id: AC-004
  statement: >-
    `content.ax0x.ai` serves the R2 release namespace with correct CORS, TLS,
    ETag and distinct pointer/immutable TTLs, and the second eligible request is
    a Cloudflare HIT with positive Age.
  source: docs/R2-PUBLIC-READ-PLAN-2026-07-14.md#infrastructure-already-provisioned
  authority: AX-selected Cloudflare R2 architecture
  verifier: bun run verify:r2-public --criterion AC-004
  pass_evidence: >-
    Recorded curl receipts show 200, expected CORS/ETag/Cache-Control, then
    CF-Cache-Status HIT and Age > 0 for current.json and an immutable object.
  fail_evidence: >-
    Expected-red baseline: before the scoped rule, JSON returned
    CF-Cache-Status DYNAMIC on 2026-07-14.
  status: BLOCKED_EXTERNAL
  depends_on: [AC-002, AC-003]
  reopen_condition: Domain/SSL/CORS/cache-rule behavior stops matching the release contract.
  last_verification: >-
    Infrastructure probe passed 2026-07-14: scoped rule active; pointer-like
    max-age=60 and immutable max-age=31536000 JSON each produced MISS -> HIT,
    preserved CORS/ETag/Cache-Control, and returned Age=22 on the same Origin
    variant. Receipt: docs/reports/r2-public-read/cache-rule-2026-07-14.md.
    Task 17 added a strict receipt parser that rejects non-production origins,
    missing CORS/ETag, collapsed TTLs and anything other than a second HIT with
    positive Age. The 2026-07-14 final-verifier attempt passed the hermetic
    repository gate and AC-001..AC-003, then failed closed here because no
    production manifest exists. Real release objects require the still-missing
    production migration/bootstrap/deploy authorization. A budgeted public HEAD
    at 2026-07-15T01:14:46Z confirmed the real `current.json` is HTTP 404 with
    `CF-Cache-Status: MISS`; no first release exists. Receipt:
    docs/reports/r2-public-read/ac-004-current-pointer-preflight-2026-07-15.md.

- id: AC-005
  statement: >-
    One snapshot reader owns pointer/manifest/hash validation, previous-release
    recovery, and controlled failure; it has no direct or transitive Turso
    dependency and never performs request-time DB fallback.
  source: docs/R2-PUBLIC-READ-PLAN-2026-07-14.md#reader-and-code-ownership
  authority: AX requirement that ordinary traffic produce no DB pressure
  verifier: bun run verify:r2-public --criterion AC-005
  pass_evidence: >-
    Reader integration tests cover current success, current corruption to
    previous, missing/corrupt previous to controlled 503, unknown schema, hash
    mismatch and timeout while a poison DB sentinel remains untouched.
  fail_evidence: >-
    Current public readers import DB-owning live loaders and no R2 reader exists.
  status: PASS_PENDING_FINAL
  depends_on: [AC-001, AC-002, AC-003]
  reopen_condition: Any snapshot-reader failure path can reach a DB module.
  last_verification: >-
    Passed locally 2026-07-14 via `bun run verify:r2-public --criterion
    AC-005`: 1 hermetic suite, 6 tests and 25 assertions under hostile inherited
    Turso/R2 credential sentinels. Active success, corrupt active manifest and
    object fallback to previous, whole-release consistency, warm last-known-good,
    missing/corrupt/unknown-schema/timeout failure, immutable caching, pinned
    origin/key validation and the recursive no-DB source boundary all passed.
    No public R2 endpoint, Turso database or production service was contacted.

- id: AC-006
  statement: >-
    All anonymous JSON, RSS, item, event, source and daily read routes use the
    snapshot reader and preserve their documented payload, localization, ETag,
    filter, sort, total and pagination contracts except AC-008's approved
    semantic-search split.
  source: docs/R2-PUBLIC-READ-PLAN-2026-07-14.md#rollout-phases
  authority: current route contracts plus AX plan approval
  verifier: bun run verify:r2-public --criterion AC-006
  pass_evidence: >-
    Consumer-side golden/parity tests cover both locales, tiers, canonical lead
    dedup, source precedence, tags, date/range/today, pagination, totals, item
    details, event members, dailies, and every RSS variant.
  fail_evidence: >-
    Current public and RSS origin-miss loaders still execute Turso-backed helpers.
  status: PASS_PENDING_FINAL
  depends_on: [AC-002, AC-005]
  reopen_condition: An inventoried anonymous API/RSS route regains DB ownership or contract parity regresses.
  last_verification: >-
    Passed locally 2026-07-14 via `bun run verify:r2-public --criterion
    AC-006`: 5 hermetic consumer suites, 30 tests and 194 assertions under
    hostile inherited Turso, embedding and R2 credential sentinels. Public
    metadata, feed/search and every main/newsletter/legacy RSS variant preserve
    their frozen payload/byte/header/error contracts; all migrated recursive
    source graphs are DB-free and GET retains implicit HEAD coverage. RSS XML
    is deterministically release-derived at the reader boundary and cached by
    release, avoiding a full-corpus publisher pass. No production service was
    contacted.

- id: AC-007
  statement: >-
    All anonymous HTML/RSC pages and dependent server/client follow-up reads use
    snapshots, `/saved` has no anonymous admin fallback or public discovery,
    calendar date prefetch is disabled, and snapshot eligibility cannot widen
    item visibility.
  source: docs/R2-PUBLIC-READ-PLAN-2026-07-14.md#product-decisions-frozen-by-this-plan
  authority: AX public-traffic invariant and privacy boundary
  verifier: bun run verify:r2-public --criterion AC-007
  pass_evidence: >-
    Browser-level route corpus passes with poison Turso; anonymous saved
    redirects/401s without querying DB; sitemap/robots exclude it; a real /all
    session emits no date-link prefetch fan-out; excluded/unenriched item
    sentinels remain unreachable.
  fail_evidence: >-
    Current home/all/curated and related pages query Turso; saved falls back to
    ADMIN_USER_ID; calendar links permit automatic prefetch.
  status: PASS_PENDING_FINAL
  depends_on: [AC-005, AC-006]
  reopen_condition: Any anonymous HTML/RSC/follow-up route can touch Turso, saved data, or a non-public item.
  last_verification: >-
    Passed locally 2026-07-14 via `bun run verify:r2-public --criterion
    AC-007`: 4 hermetic page/privacy suites, 16 tests and 88 assertions under
    hostile inherited Turso/R2 credential sentinels. All ten anonymous page
    variants render from an injected snapshot; recursive source graphs are
    DB-free; controlled unavailable, public-only rubric/detail fields, disabled
    calendar prefetch, saved denial and robots/sitemap exclusion passed. Task 16
    still owns authoritative compiled-runtime and real-browser poison-Turso
    evidence before final acceptance.

- id: AC-008
  statement: >-
    Anonymous lexical search is snapshot-backed; anonymous semantic mode has a
    documented unsupported response and migration note; bearer-authenticated
    semantic search remains explicit and no public semantic request falls back
    to Turso.
  source: docs/R2-PUBLIC-READ-PLAN-2026-07-14.md#product-decisions-frozen-by-this-plan
  authority: AX approval of this plan; changing this decision requires a new goal version
  verifier: bun run verify:r2-public --criterion AC-008
  pass_evidence: >-
    Lexical parity tests pass over published shards, semantic public requests
    return the documented status/envelope without embedding or DB calls, and
    OpenAPI/skill/agent docs match runtime behavior.
  fail_evidence: >-
    Current anonymous semantic search generates an embedding and executes a
    Turso vector query.
  status: PASS_PENDING_FINAL
  depends_on: [AC-002, AC-005]
  reopen_condition: Anonymous semantic mode reaches embedding/Turso or public docs disagree with runtime.
  last_verification: >-
    Passed locally 2026-07-14 via `bun run verify:r2-public --criterion
    AC-008`: 1 hermetic suite, 6 tests and 50 assertions under hostile inherited
    Turso, embedding and R2 credential sentinels. Frozen-corpus feed/lexical
    parity, localization, filters, wildcard LIKE, ordering, totals, pagination,
    ETag/304, semantic 422-before-I/O, recursive no-DB/no-semantic source graphs,
    and OpenAPI/skill documentation all passed. V1/MCP live semantic code was
    not changed and no production service was contacted.
- id: AC-009
  statement: >-
    A generated anonymous-entrypoint inventory, recursive source import-graph
    guard, and post-build NFT guard prove that public serving bundles contain no
    DB client, libSQL package, publisher module, Turso secret name, or unlisted
    anonymous DB entrypoint.
  source: docs/R2-PUBLIC-READ-PLAN-2026-07-14.md#reader-and-code-ownership
  authority: repository architecture-as-API rule and AX no-public-DB invariant
  verifier: bun run verify:r2-public --criterion AC-009
  pass_evidence: >-
    A known-bad import mutation first fails both recursive source and .nft.json
    guards; restored production build passes and inventory coverage matches all
    anonymous GET/HEAD/RSC entrypoints.
  fail_evidence: >-
    Existing home/all/public-feed NFT manifests include @libsql/client.
  status: PASS_PENDING_FINAL
  depends_on: [AC-005, AC-006, AC-007, AC-008]
  reopen_condition: A new anonymous entrypoint is absent from inventory or an existing bundle/import graph reaches a forbidden module.
  last_verification: >-
    Passed locally 2026-07-14 via `bun run verify:r2-public --criterion
    AC-009`: 3 hermetic mutation/inventory suites, 26 tests and 248 assertions;
    a fresh production build with Turso credentials absent; 136 recursively
    reached anonymous source files and 265 selected server/client/Proxy/NFT
    artifacts free of DB client, publisher and Turso markers. Synthetic NFT,
    compiled-byte and browser-chunk contamination all failed as expected.

- id: AC-010
  statement: >-
    A cold build/runtime with Turso credentials absent or deliberately invalid
    serves the full anonymous HTML/API/RSS/RSC corpus from a valid snapshot with
    no unexpected 5xx.
  source: docs/R2-PUBLIC-READ-PLAN-2026-07-14.md#acceptance-contract
  authority: AX no-public-DB invariant
  verifier: bun run verify:r2-public --criterion AC-010
  pass_evidence: >-
    Preview/local consumer smoke receipt enumerates every route, response code,
    schema/version and snapshot release while a network-level poison DB endpoint
    records zero connection attempts.
  fail_evidence: >-
    Current anonymous pages require Turso and cannot satisfy this deployment contract.
  status: PASS_PENDING_FINAL
  depends_on: [AC-006, AC-007, AC-008, AC-009]
  reopen_condition: Any anonymous route requires Turso env or attempts a DB connection.
  last_verification: >-
    Passed locally 2026-07-14 via `bun run verify:r2-public --criterion
    AC-010`: a fresh production build with Turso credentials absent, followed
    by 2 runtime/browser tests and 163 assertions. All 30 anonymous inventory
    entries passed GET/HEAD, every public page passed RSC, real Chrome hydrated
    `/en/all` without calendar-date prefetch, and the recording poison Turso
    endpoint observed exactly zero connection attempts. No production service
    was contacted.

- id: AC-011
  statement: >-
    Anonymous request volume is empirically decoupled from Turso for warm CDN,
    cold CDN, cold deployment and snapshot-failure cases.
  source: docs/R2-PUBLIC-READ-PLAN-2026-07-14.md#acceptance-contract
  authority: AX traffic-scaling requirement
  verifier: bun run verify:r2-public --criterion AC-011
  pass_evidence: >-
    Recorded 1x/10x/100x session replays have zero unexpected 5xx and exact
    Turso rows_read(load)-rows_read(equal control)=0 within the API's accounting
    resolution; results include cold deploy/cache miss and never infer success
    from CDN HIT alone.
  fail_evidence: >-
    Current public routes have DB-owning origin paths and observed RSC prefetch amplification.
  status: BLOCKED_EXTERNAL
  depends_on: [AC-004, AC-010]
  reopen_condition: Turso read delta becomes positively correlated with anonymous traffic or a cold/failure path queries DB.
  last_verification: >-
    Local harness passed 2026-07-14 for bounded deterministic 1x/10x/100x
    corpora and warm/cache-miss/cold-deploy/missing-object scenarios. The
    criterion verifier requires matching production load/control Turso receipts
    and therefore remains externally blocked; no production load was run.

- id: AC-012
  statement: >-
    A clean exact 24-hour production window projects below 100M Turso rows/month,
    publisher reads project below 5M/month, and any residual above the preferred
    10M/month line is attributed to non-public consumers with a bounded follow-up.
  source: docs/R2-PUBLIC-READ-PLAN-2026-07-14.md#acceptance-contract
  authority: AX hard target <100M/month and preferred target <10M/month
  verifier: bun run verify:r2-public --criterion AC-012
  pass_evidence: >-
    Turso from/to receipt for >=24 clean hours reports <136986 rows/hour; R2 run
    receipts report publisher projection <5M/month; <13699 rows/hour is marked
    preferred-target-met, otherwise a measured cron/auth/MCP decomposition and
    bounded next inventory is attached without blaming anonymous traffic.
  fail_evidence: >-
    Recent post-W9 windows projected roughly 240–290M/month and no clean
    post-snapshot window exists.
  status: BLOCKED_EXTERNAL
  depends_on: [AC-003, AC-011]
  reopen_condition: A later clean window projects >=100M/month, publisher >=5M/month, or the residual attribution is invalidated.
  last_verification: >-
    Exact-window and publisher receipt aggregation passed locally 2026-07-14,
    including rejection of inconsistent derived counters. The last production
    rate remains known-red and no new production measurement was run, so this
    criterion remains externally blocked.

- id: AC-013
  statement: >-
    Current docs and runbooks accurately describe public/publisher/private data
    ownership, search behavior, safe testing, cache rule, monitoring, rollback,
    credential handling, and the final measured budget.
  source: docs/R2-PUBLIC-READ-PLAN-2026-07-14.md#acceptance-contract
  authority: AGENTS.md documentation routing and architecture maintainability rule
  verifier: bun run verify:r2-public --criterion AC-013
  pass_evidence: >-
    Docs index, architecture overview/ingestion, agent access, testing strategy,
    environment example, handoff and operator runbook pass link/contract checks
    and agree with runtime/source inventories.
  fail_evidence: >-
    Current docs describe the pre-snapshot ownership model and production-backed default test command.
  status: BLOCKED_EXTERNAL
  depends_on: [AC-004, AC-006, AC-007, AC-008, AC-012]
  reopen_condition: Runtime ownership, public API behavior, ops procedure, or measured budget changes without matching docs.
  last_verification: >-
    Local documentation contract passed 2026-07-14: docs index, ownership map,
    ingestion, agent access, testing strategy, environment template, handoff and
    operator runbook agree with runtime. AC-013 now has a fail-closed criterion
    implementation that additionally requires the production manifest, >=48h
    stability, a conditional rollback drill, shipped-status docs and exact
    measured total/publisher projections. It remains externally blocked until
    those production actions and doc updates are authorized and completed.
```
