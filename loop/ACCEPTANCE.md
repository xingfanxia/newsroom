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
  status: OPEN
  depends_on: [AC-001]
  reopen_condition: A persisted schema changes or a forbidden-field sentinel serializes successfully.
  last_verification: >-
    Task 5 foundation passed locally 2026-07-14: strict schema-v1 contracts,
    forbidden-field sentinels, fail-closed eligibility, canonical byte/hash
    fixtures, safe R2 paths, and receipt invariants passed 34/34 focused tests
    and two independent reviews with 0 Critical/High findings. AC-002 remains
    OPEN and its criterion verifier has not run because Task 6 frozen parity
    fixtures and pure query/derivation engine are still pending. Receipt:
    docs/reports/r2-public-read/ac-002-task-5-snapshot-contracts-2026-07-14.md.

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
  status: OPEN
  depends_on: [AC-001, AC-002]
  reopen_condition: Any publish path can advance a partial release, lose a concurrent change, or rescan the corpus on a no-change tick.
  last_verification: Not run; implementation absent 2026-07-14.

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
  status: OPEN
  depends_on: [AC-002, AC-003]
  reopen_condition: Domain/SSL/CORS/cache-rule behavior stops matching the release contract.
  last_verification: >-
    Infrastructure probe passed 2026-07-14: scoped rule active; pointer-like
    max-age=60 and immutable max-age=31536000 JSON each produced MISS -> HIT,
    preserved CORS/ETag/Cache-Control, and returned Age=22 on the same Origin
    variant. Receipt: docs/reports/r2-public-read/cache-rule-2026-07-14.md.
    Remains OPEN until real release objects pass after AC-002/AC-003.

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
  status: OPEN
  depends_on: [AC-001, AC-002, AC-003]
  reopen_condition: Any snapshot-reader failure path can reach a DB module.
  last_verification: Not run; implementation absent 2026-07-14.

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
  status: OPEN
  depends_on: [AC-002, AC-005]
  reopen_condition: An inventoried anonymous API/RSS route regains DB ownership or contract parity regresses.
  last_verification: Not run; current source is known red 2026-07-14.

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
  status: OPEN
  depends_on: [AC-005, AC-006]
  reopen_condition: Any anonymous HTML/RSC/follow-up route can touch Turso, saved data, or a non-public item.
  last_verification: >-
    Partial local evidence 2026-07-14: Task 3 removed the anonymous saved admin
    fallback, proved page/export denial before DB/body loaders, removed saved
    from sitemap and disallowed all locale variants in robots, and disabled all
    CalendarGrid Link prefetch. AC-007 remains OPEN for snapshot-backed HTML/RSC,
    browser poison-Turso corpus, and item-eligibility proof. Receipt:
    docs/reports/r2-public-read/ac-007-task-3-saved-boundary-2026-07-14.md.

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
  status: OPEN
  depends_on: [AC-002, AC-005]
  reopen_condition: Anonymous semantic mode reaches embedding/Turso or public docs disagree with runtime.
  last_verification: Not run; current source is known red 2026-07-14.

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
  status: OPEN
  depends_on: [AC-005, AC-006, AC-007, AC-008]
  reopen_condition: A new anonymous entrypoint is absent from inventory or an existing bundle/import graph reaches a forbidden module.
  last_verification: Known-red build-artifact evidence recorded 2026-07-14.

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
  status: OPEN
  depends_on: [AC-006, AC-007, AC-008, AC-009]
  reopen_condition: Any anonymous route requires Turso env or attempts a DB connection.
  last_verification: Not run; current architecture is known red 2026-07-14.

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
  status: OPEN
  depends_on: [AC-004, AC-010]
  reopen_condition: Turso read delta becomes positively correlated with anonymous traffic or a cold/failure path queries DB.
  last_verification: Not run; current architecture is known red 2026-07-14.

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
  status: OPEN
  depends_on: [AC-003, AC-011]
  reopen_condition: A later clean window projects >=100M/month, publisher >=5M/month, or the residual attribution is invalidated.
  last_verification: Known-red production-rate evidence recorded 2026-07-14.

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
  status: OPEN
  depends_on: [AC-004, AC-006, AC-007, AC-008, AC-012]
  reopen_condition: Runtime ownership, public API behavior, ops procedure, or measured budget changes without matching docs.
  last_verification: Not run; implementation not shipped 2026-07-14.
```
