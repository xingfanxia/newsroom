# R2 Public-Read Goal State

```yaml
archetype: goal
identity: r2-public-read-decoupling
runnable: true
goal_version: r2-public-read-v1-ec57c55fe111
primitive_bundle:
  target_shape: finite-criteria
  halt_shape: terminal
  artifact_shape: acceptance-inventory
  convergence_shape: criteria-completion
  cadence_shape: sync
divergences: []
overlays: []
consult_tier: tier-2
evaluator_tier: n/a
derivation_read_set:
  - /Users/xingfanxia/projects/_forks/loopgen/loopgen/templates/composed-prompt.md
  - /Users/xingfanxia/projects/_forks/loopgen/loopgen/primitives/target-shape.md
  - /Users/xingfanxia/projects/_forks/loopgen/loopgen/primitives/halt-shape.md
  - /Users/xingfanxia/projects/_forks/loopgen/loopgen/primitives/artifact-shape.md
  - /Users/xingfanxia/projects/_forks/loopgen/loopgen/primitives/convergence-shape.md
  - /Users/xingfanxia/projects/_forks/loopgen/loopgen/primitives/cadence-shape.md
  - /Users/xingfanxia/projects/_forks/loopgen/loopgen/primitives/consult-capability.md
  - /Users/xingfanxia/projects/_forks/loopgen/loopgen/primitives/frontload-audit.md
  - /Users/xingfanxia/projects/_forks/loopgen/loopgen/primitives/runner-contract.md
  - /Users/xingfanxia/projects/_forks/loopgen/loopgen/primitives/judgment-default.md
  - /Users/xingfanxia/projects/_forks/loopgen/loopgen/primitives/evidence-tier.md
  - /Users/xingfanxia/projects/_forks/loopgen/loopgen/primitives/halt-cause-classifier.md
  - /Users/xingfanxia/projects/_forks/loopgen/loopgen/primitives/queue-as-second-artifact.md
  - /Users/xingfanxia/projects/_forks/loopgen/loopgen/primitives/pressure.md
  - /Users/xingfanxia/projects/_forks/loopgen/loopgen/archetypes/goal.md
  - /Users/xingfanxia/projects/_forks/loopgen/loopgen/templates/bodies/goal-body.md
  - /Users/xingfanxia/projects/_forks/loopgen/loopgen/references/oracle-principles.md
  - AGENTS.md
  - docs/README.md
  - docs/HANDOFF.md
  - docs/architecture/overview.md
  - docs/architecture/ingestion.md
  - docs/agent-access/README.md
  - docs/testing/strategy.md
  - docs/R2-PUBLIC-READ-PLAN-2026-07-14.md
  - package.json
  - vercel.json
frontload:
  resolved:
    - motive and finite acceptance source
    - anonymous versus authenticated/mutation scope
    - R2 bucket, production domain, CORS and Vercel Production credentials
    - scoped Cloudflare Cache Rule with edge/browser respect-origin TTL and MISS-to-HIT proof
    - hard <100M/month and preferred <10M/month thresholds
    - snapshot/no-DB-fallback architecture
    - anonymous semantic-search default
    - exact final-verify command and dependency topology
    - hermetic-test prerequisite and known false-green zone
    - metered integration-run caps
    - tier-2 programmatic consult availability
  defaulted:
    - incremental outbox publisher at 12,27,42,57 minutes
    - immutable content-addressed releases with current/previous pointers
    - local focused Conventional Commits allowed; no push
    - production cutover and user-visible semantic change require external authorization
  open_gaps:
    - external-gate: production deploy/publish/cutover authorization after local and preview gates
artifacts:
  canonical:
    - loop/PROMPT.md
    - loop/STATE.md
    - loop/PRESSURE.md
    - loop/ACCEPTANCE.md
    - loop/VERIFY.md
  repo_aliases:
    plan: docs/R2-PUBLIC-READ-PLAN-2026-07-14.md
    evidence: docs/reports/r2-public-read/
iteration: 11
phase: implementation
current_artifact: docs/superpowers/plans/2026-07-14-r2-public-read-decoupling.md
current_criterion: AC-003
last_action: >-
  Completed Task 10 locally: added stable content-addressed entity shards, a
  deterministic incremental release builder, an injected conditional object
  store, pointer-last publisher orchestration, and a pinned R2 S3 adapter using
  region auto plus If-None-Match/If-Match. Event-log fakes prove content
  readback precedes manifest, manifest precedes pointer CAS, explicit CAS loss
  never acks, ambiguous CAS requires matching reread, post-commit ack failure
  retries without a duplicate release, concurrent later outbox IDs survive,
  unchanged hashes reuse bytes, and 1/100 changes load exactly 1/100 stable
  shards despite 2,000 unrelated descriptors. Mocked S3 tests prove command
  shape and conditional error mapping. The focused suites passed 10/10 with 70
  assertions, typecheck passed, and focused lint had no remaining findings.
  AC-003 remains OPEN for Task 11's operational surface. No R2/Turso/Cloudflare
  mutation, snapshot publish, deploy, bootstrap, or production request ran.
next_action: >-
  Continue AC-003 with Task 11's authenticated cron/operator wiring, explicit
  one-shot bootstrap guard, bounded reconciliation, and pure retention planner.
  Keep execution on fakes/local fixtures and do not apply the outbox migration,
  access production R2, publish/bootstrap, deploy, or cut over routes without
  AX authorization.
halt_cause: null
halt_scan: []
stuck_counters: {}
final_verify: bun run verify:r2-public --final
oracle_change_notes: []
attempts:
  - iteration: 8
    criterion: AC-002
    failing_evidence: >-
      Strict persisted contracts exist, but AC-002 remains OPEN because no
      independent pre-change parity corpus or pure query/derivation engine
      proves the contracts preserve public feed, shell, daily and RSS behavior.
    hypothesis: >-
      Hash-frozen hand-authored fixtures plus a framework-free engine over
      CanonicalPublicState can prove eligibility, filtering, lead deduplication,
      ordering, pagination and exact RSS bytes without importing DB, Next,
      process environment, filesystem or network code.
    edit_surface:
      - lib/public-content/query.ts
      - lib/public-content/derive.ts
      - lib/public-content/public-items.ts
      - lib/public-content/public-dailies.ts
      - lib/public-content/rss.ts
      - lib/rss/render.ts
      - tests/public-content/query.test.ts
      - tests/public-content/derive-parity.test.ts
      - tests/public-content/rss.test.ts
      - tests/public-content/fixtures/
    rollback: >-
      Revert only iteration-8 engine/fixture/state changes if independent
      mutants do not red, parity cannot be sourced from pre-change contracts,
      or the cheap/criterion guards regress.
  - iteration: 9
    criterion: AC-003
    failing_evidence: >-
      No checksummed schema migration, public_content_outbox table, or narrow
      public-change triggers exist, so publisher work cannot be bounded by a
      captured mutation high-water mark and same-value/private-only writes
      cannot be proven to remain no-ops.
    hypothesis: >-
      One additive raw-SQL migration with checksum enforcement, entity-keyed
      append-only rows, column-scoped UPDATE predicates, OLD+NEW cluster
      dependency events, and high-water deletion can make no-change work O(1)
      while preserving every concurrent mutation for a later publisher run.
    edit_surface:
      - db/schema.ts
      - lib/public-content/publisher/outbox-migration.ts
      - scripts/ops/migrate-public-content-outbox.ts
      - tests/public-content/outbox-migration.test.ts
      - loop/STATE.md
    rollback: >-
      Revert iteration-9 local files if idempotency, checksum drift, relevant
      column coverage, same-value/private no-op, high-water retention, or
      required EXPLAIN plans cannot be proven on file-backed libSQL. Never
      apply the unaccepted migration to production.
  - iteration: 10
    criterion: AC-003
    failing_evidence: >-
      The accepted outbox can bound mutation discovery, but no publisher source
      adapter deduplicates its keys, returns current rows/tombstones, batches
      event members, enforces dependent-row caps, or reports plan-backed read
      telemetry; AC-003 therefore still lacks bounded-read proof.
    hypothesis: >-
      A single injected libSQL adapter using PK/declared-index queries and hard
      caps, paired with a pure canonical-state patcher, can make empty work
      outbox-only and changed work proportional to deduped entity/dependency
      rows without an event-member N+1 path.
    edit_surface:
      - lib/public-content/publisher/types.ts
      - lib/public-content/publisher/source.ts
      - lib/public-content/publisher/patch-state.ts
      - tests/public-content/publisher-source.test.ts
      - loop/STATE.md
    rollback: >-
      Revert iteration-10 files if empty reads touch content tables, query
      counts scale per entity/event, malformed/out-of-cap batches partially
      return, tombstones drift, or EXPLAIN cannot prove the named PK/index
      bounds on temporary libSQL.
  - iteration: 11
    criterion: AC-003
    failing_evidence: >-
      The bounded source can describe changed public entities, but no
      content-addressed release builder, conditional object-store port, R2 S3
      adapter, pointer-last commit protocol, or post-CAS acknowledgement retry
      exists. A publisher therefore cannot yet prove atomicity or idempotency.
    hypothesis: >-
      Stable entity shards plus immutable conditional puts, mandatory
      readback validation, deterministic manifests and one ETag CAS commit can
      make recurring work proportional to touched shards while preserving
      outbox rows across every pre-commit failure and ambiguous commit result.
    edit_surface:
      - package.json
      - bun.lock
      - lib/public-content/canonical.ts
      - lib/public-content/publisher/object-store.ts
      - lib/public-content/publisher/r2-store.ts
      - lib/public-content/publisher/build-release.ts
      - lib/public-content/publisher/publish.ts
      - tests/public-content/publisher.test.ts
      - tests/public-content/r2-store.test.ts
      - loop/STATE.md
    rollback: >-
      Revert iteration-11 files if immutable object readback, manifest-before-
      pointer ordering, CAS-loss/ambiguity handling, ack retry, deterministic
      reuse, or touched-shard scale bounds cannot be proven entirely on fakes.
budget:
  source: loop/PROMPT.md immutable human-authored policy
  r2_object_writes_per_run: 500
  public_http_requests_per_run: 10000
  upload_or_test_transfer_bytes_per_run: 1073741824
  bootstrap_snapshots_total: 1
  production_backed_default_tests: 0
  intentional_turso_windows: named-only
  spend_ledger: []
pressure_objects:
  - id: P-public-db-zero
    source: authored
    scope: all anonymous GET/HEAD/RSC/API/RSS entrypoints
    mode: constraint
    strength: high
    satisfied_by: AC-009 + AC-010 + AC-011 tier-1/2 receipts
    on_violation: blocks
    expires: goal version reaches criteria-met or AX changes the invariant
    status: active
  - id: P-rows-hard
    source: authored
    scope: total Turso rows_read
    mode: constraint
    strength: high
    satisfied_by: AC-012 exact >=24h from/to receipt under 136986 rows/hour
    on_violation: blocks
    expires: goal version reaches criteria-met or AX changes the hard target
    status: active
  - id: P-rows-ideal
    source: authored
    scope: total Turso rows_read
    mode: preference
    strength: high
    satisfied_by: AC-012 exact >=24h from/to receipt under 13699 rows/hour
    on_violation: owes_explanation
    expires: preferred line is met or AX explicitly retires the preference
    status: active
  - id: P-safe-tests
    source: mined
    provenance: docs/HANDOFF.md gate-hygiene follow-up and package.json test script
    scope: verification and integration tests
    mode: salience
    strength: low
    satisfied_by: AC-001 red/green hermetic and timeout-sentinel receipts
    on_violation: owes_proof
    expires: AC-001 passes and reopens only on harness regression
    status: active
  - id: P-architecture-api
    source: mined
    provenance: AGENTS.md Development North Star and docs/architecture/overview.md
    scope: public-content module/import ownership
    mode: salience
    strength: low
    satisfied_by: AC-009 recursive import and NFT bundle receipts
    on_violation: owes_explanation
    expires: AC-009 passes and reopens on boundary regression
    status: active
  - id: P-metered-cap
    source: authored
    scope: unattended cloud and production integration work
    mode: constraint
    strength: high
    satisfied_by: write-ahead spend ledger plus per-run cap verifier
    on_violation: blocks
    expires: goal version reaches criteria-met
    status: active
pressure_ledger:
  - 2026-07-14: seeded six frontload pressures from AX requirements and grep-confirmed repo conventions
  - 2026-07-14: accepted Task 1 only after focused TDD, adversarial review fixes, and reviewed-diff hash preservation
  - 2026-07-14: made AC-001 pass locally only after Next-loader token shadowing, fail-loud integration inventory, and a pristine default gate
  - 2026-07-14: closed Task 2 review gaps by regular-file allowlisting focused inputs and eliminating production data-dependent bare returns
  - 2026-07-14: accepted Task 3 after executable zero-loader saved denial, real Proxy locale tests, recursive DB-free import proof, and all-link prefetch coverage
  - 2026-07-14: accepted Task 4 after exhaustive Next 16 source/build inventory, real Edge/parallel-route probes, decomposed fail-closed guards, and dual independent approval
  - 2026-07-14: accepted Task 5 after strict persisted contracts, canonical-byte adversarial fixtures, fail-closed eligibility/receipt hardening, and dual independent approval
pressure_consulted:
  - iteration: 1
    consulted_at: 2026-07-14
    ids:
      - P-public-db-zero
      - P-rows-hard
      - P-rows-ideal
      - P-safe-tests
      - P-architecture-api
      - P-metered-cap
    influence:
      P-public-db-zero: >-
        Kept request-time DB fallback forbidden even for cold CDN/deploy and
        snapshot-failure paths; public readers will fail stale/503 instead.
      P-rows-hard: >-
        Preserved exact-window <136986 rows/hour as a terminal production gate.
      P-rows-ideal: >-
        Kept incremental outbox publishing and residual attribution in scope so
        the preferred <13699 rows/hour line remains actionable rather than erased.
      P-safe-tests: >-
        Made AC-001 the first implementation task and prohibited the existing
        `bun run test`/`bun run verify` commands until hermetic RED/GREEN proof.
      P-architecture-api: >-
        Required one typed public-content boundary plus recursive import and NFT
        guards instead of relying on route-local convention or CDN headers.
      P-metered-cap: >-
        Limited this iteration to local/read-only work; no production publish,
        deploy, migration, traffic replay, or additional Cloudflare mutation.
  - iteration: 2
    consulted_at: 2026-07-14
    ids:
      - P-safe-tests
      - P-metered-cap
    influence:
      P-safe-tests: >-
        Kept all verification focused and explicitly no-env-file, added hostile
        exit-zero, ANSI, secret-leak, timeout, and descendant-process cases, and
        left AC-001 open until Task 2 rewires the default package commands.
      P-metered-cap: >-
        Used only local fake fixtures and process probes; performed no DB, R2,
        Cloudflare, deploy, publish, push, or production traffic operation.
  - iteration: 3
    consulted_at: 2026-07-14
    ids:
      - P-safe-tests
      - P-metered-cap
      - P-architecture-api
    influence:
      P-safe-tests: >-
        Reclassified every real-Turso suite as an explicit fail-loud input,
        shadowed every repo-relevant Next-visible controlled credential with a
        local/fake value, and required exit status, clean output, and completion
        sentinels before the default gate could pass.
      P-metered-cap: >-
        Ran only file-backed libSQL, in-memory fake R2, temporary dotenv probes,
        and local test processes; production integration and all cloud mutations
        remained at zero.
      P-architecture-api: >-
        Centralized production-test ownership in one manifest/README and made
        the newsletter selector accept a typed pure loader so its default test
        no longer depends on ambient database state.
  - iteration: 4
    consulted_at: 2026-07-14
    ids:
      - P-safe-tests
      - P-metered-cap
    influence:
      P-safe-tests: >-
        Converted focused test selection from path validation to strict
        regular-file allowlisting and replaced every production integration
        bare return with a named failing data precondition.
      P-metered-cap: >-
        Verified the production-directory bypass only as an expected local
        rejection; no production integration child or external request ran.
  - iteration: 5
    consulted_at: 2026-07-14
    ids:
      - P-public-db-zero
      - P-safe-tests
      - P-architecture-api
      - P-metered-cap
    influence:
      P-public-db-zero: >-
        Removed anonymous saved fallback before any DB-capable dependency and
        disabled automatic CalendarGrid follow-up requests at their Link source.
      P-safe-tests: >-
        Used injectable poison dependencies and real Proxy requests without
        process-global mocks; the accepted hermetic gate stayed green.
      P-architecture-api: >-
        Split cookie identity from DB-owning session persistence and made the
        saved hard-auth/data boundary explicit and typed for future agents.
      P-metered-cap: >-
        Used only local request/component tests; no production DB, R2,
        Cloudflare, deploy, publish, push, or traffic replay was performed.
  - iteration: 6
    consulted_at: 2026-07-14
    ids:
      - P-public-db-zero
      - P-rows-hard
      - P-rows-ideal
      - P-safe-tests
      - P-architecture-api
      - P-metered-cap
    influence:
      P-public-db-zero: >-
        Required every ambiguous Next 16 source/build surface to fail closed;
        NFT-less Edge execution remains explicitly unverified until Task 16
        proves compiled bytes and poison runtime rather than accepting a false
        green manifest-only result.
      P-rows-hard: >-
        No production Turso measurement was run; the exact AC-012 hard threshold
        remains unchanged and this local boundary iteration spent zero rows.
      P-rows-ideal: >-
        No-effect on the preferred numeric line: Task 4 establishes ownership
        proof but does not add a recurring reader or publisher database query.
      P-safe-tests: >-
        Accepted only no-env-file hermetic focused and full gates, including
        explicit completion/assertion counts and expected-red source/build exits.
      P-architecture-api: >-
        Decomposed the new scanners into typed, acyclic modules with thin facades,
        files within source/test budgets, and production functions at most 48 lines.
      P-metered-cap: >-
        Used temporary local fixtures and bounded local Next probes only; no R2,
        Cloudflare, Turso, deploy, publish, push, or public traffic operation ran.
  - iteration: 7
    consulted_at: 2026-07-14
    ids:
      - P-public-db-zero
      - P-rows-hard
      - P-rows-ideal
      - P-safe-tests
      - P-architecture-api
      - P-metered-cap
    influence:
      P-public-db-zero: >-
        Made persisted public data an explicit strict allowlist and required
        malformed items/events to fail closed; Task 5 adds no request-time DB
        fallback or DB-owning import.
      P-rows-hard: >-
        No-effect on the numeric threshold: this pure-contract iteration made no
        Turso request, and AC-012 remains unchanged.
      P-rows-ideal: >-
        No-effect on the preferred numeric line: publisher/query work starts in
        later tasks, while this iteration only freezes safe public bytes.
      P-safe-tests: >-
        Used the accepted no-env hermetic focused gate and complete verify gate,
        with assertion counts and independent adversarial review before acceptance.
      P-architecture-api: >-
        Split entities, state, release, primitives, canonicalization,
        eligibility, paths, and rubric logic into focused typed modules behind a
        thin public contracts facade.
      P-metered-cap: >-
        Used local fixtures and processes only; no Turso, R2, Cloudflare,
        deploy, publish, push, migration, or production traffic operation ran.
  - iteration: 8
    consulted_at: 2026-07-14
    ids:
      - P-public-db-zero
      - P-rows-hard
      - P-rows-ideal
      - P-safe-tests
      - P-architecture-api
      - P-metered-cap
    influence:
      P-public-db-zero: >-
        The Task 6 engine consumes validated canonical state only, enforces
        public eligibility, and imports no DB-owning or fallback path.
      P-rows-hard: >-
        No-effect on the numeric threshold: Task 6 is local pure computation
        and performs no Turso query or production measurement.
      P-rows-ideal: >-
        No-effect on the preferred line: incremental publisher costs remain a
        later criterion and this iteration adds no recurring read path.
      P-safe-tests: >-
        Used only the established hermetic cheap/criterion channels and local
        fixtures; production-backed default tests remained at zero.
      P-architecture-api: >-
        Kept query and derivation ownership in five framework-free typed
        modules behind the public-content contract instead of route copies.
      P-metered-cap: >-
        No cloud or production integration ran; R2 writes, public requests,
        uploaded bytes, bootstraps and intentional Turso spend were zero.
  - iteration: 9
    consulted_at: 2026-07-14
    ids:
      - P-public-db-zero
      - P-rows-hard
      - P-rows-ideal
      - P-safe-tests
      - P-architecture-api
      - P-metered-cap
    influence:
      P-public-db-zero: >-
        Keeps outbox and migration ownership publisher-only; this iteration
        adds no anonymous reader import, cache-aside path, or DB fallback.
      P-rows-hard: >-
        Requires O(1) empty polling and indexed bounded reads/deletes so the
        publisher cannot replace traffic pressure with corpus-wide cron scans.
      P-rows-ideal: >-
        Prefers narrow same-value-aware triggers and entity coalescing to keep
        steady publisher reads near the <10M/month target rather than merely
        below the hard cap.
      P-safe-tests: >-
        Uses a temporary file-backed libSQL database and no-env focused tests;
        no default or production-backed suite is authorized.
      P-architecture-api: >-
        Places raw additive migration SQL and its injectable runner under the
        publisher boundary, with a thin explicit operator script.
      P-metered-cap: >-
        Local SQL fixtures only; Turso, R2, Cloudflare, public HTTP, deploy,
        publish, bootstrap and production migration spend remain zero.
  - iteration: 10
    consulted_at: 2026-07-14
    ids:
      - P-public-db-zero
      - P-rows-hard
      - P-rows-ideal
      - P-safe-tests
      - P-architecture-api
      - P-metered-cap
    influence:
      P-public-db-zero: >-
        Keeps all DB ownership in publisher/source.ts; the state patcher and
        existing request-side public engine remain DB-free.
      P-rows-hard: >-
        Requires an outbox-only no-change return, fixed query count by entity
        type, one batched event-member read and hard aborting row caps.
      P-rows-ideal: >-
        Uses key deduplication and PK/index seeks so repeated writes coalesce
        before fetching content rows.
      P-safe-tests: >-
        Uses one temporary file-libSQL focused suite plus typecheck only.
      P-architecture-api: >-
        Separates the sole SQL adapter from pure canonical-state patch logic
        through explicit typed changes and telemetry.
      P-metered-cap: >-
        No production DB, R2, Cloudflare, public request, deploy, publish or
        migration action is permitted; external spend stays zero.
  - iteration: 11
    consulted_at: 2026-07-14
    ids:
      - P-public-db-zero
      - P-rows-hard
      - P-rows-ideal
      - P-safe-tests
      - P-architecture-api
      - P-metered-cap
    influence:
      P-public-db-zero: >-
        Keeps the S3 client and credentials publisher-only; request-side code
        receives neither writer imports nor a database fallback.
      P-rows-hard: >-
        Makes empty work pointer/outbox-only and changed work load only stable
        touched shards rather than materializing the corpus.
      P-rows-ideal: >-
        Reuses identical content hashes and deterministic release bytes so
        retries do not repeat DB reads or object uploads unnecessarily.
      P-safe-tests: >-
        Uses event-log fakes and mocked S3 commands plus typecheck; no cloud
        integration suite or broad repository gate is needed for this task.
      P-architecture-api: >-
        Separates the pure release builder and object-store port from the R2
        SDK adapter and pointer-last orchestration.
      P-metered-cap: >-
        Dependency metadata lookup is the only network read; R2, Turso,
        Cloudflare, deploy, publish, bootstrap and public HTTP spend stay zero.
```

## Alignment reviews

### AR-001 — anonymous semantic search

- Problem: R2 alone cannot efficiently preserve arbitrary semantic vector search.
- Options: public Turso fallback; publish/scan vectors; add Worker/Vectorize;
  move semantic mode behind bearer auth.
- Chosen contract: snapshot lexical search publicly; semantic stays
  bearer-authenticated; public semantic returns a documented unsupported-mode
  response.
- Alignment cost: one explicit anonymous API behavior change.
- Rollback trigger: AX requires anonymous semantic parity and authorizes a
  separately budgeted Vectorize/Worker architecture.
- Review result: approved by AX on goal launch; changing this contract requires
  goal-version re-derivation.

### AR-002 — publisher cadence

- Problem: frequent full rebuilds would merely move DB pressure from users to cron.
- Options: three full builds/day; frequent full builds; 15-minute incremental outbox.
- Chosen contract: 15-minute coalesced incremental outbox plus one bounded daily reconciliation.
- Alignment cost: more implementation complexity and trigger/outbox tests.
- Rollback trigger: measured publisher projection exceeds 5M rows/month or
  outbox correctness cannot be proven.
- Review result: approved by AX on goal launch; changing this contract requires
  goal-version re-derivation.

### AR-003 — isolated implementation worktree

- Problem: the approved goal artifacts were uncommitted on `main`, while the
  repository has no ignored project-local worktree directory.
- Options: implement in the dirty main checkout; add a shared `.worktrees`
  ignore rule; use an external Codex-owned linked worktree.
- Chosen contract: first commit the canonical goal/bootstrap artifacts on
  `codex/r2-public-read`, then attach that branch at
  `~/.codex/worktrees/newsroom/r2-public-read` and restore the primary checkout
  to `main`.
- Alignment cost: worktree commands use an external absolute path rather than a
  project-local `.worktrees` path.
- Rollback trigger: worktree creation fails or would overwrite an existing
  checkout; remove only the newly-created worktree and retain the feature branch.
- Review result: reversible local default; no external authorization required.

### AR-004 — anonymous semantic error envelope

- Problem: the approved plan freezes an unsupported anonymous semantic mode but
  does not freeze its byte-level HTTP response.
- Options: 400 unsupported mode; 403 auth required; 422 authenticated-capability
  required; 501 not implemented.
- Chosen contract: HTTP 422 with the existing public CORS error shape
  `{ "error": "semantic_search_requires_auth" }`; lexical remains the public
  alternative and v1/MCP semantic remains bearer-authenticated.
- Alignment cost: clients receive one new stable status/error pair for the
  already-approved behavior change.
- Rollback trigger: current public error conventions or OpenAPI compatibility
  tests prove a different existing contract is required.
- Review result: smallest documented implementation detail allowed by AC-008.

### AR-005 — public “why featured” without raw reasoning

- Problem: anonymous HTML currently renders raw reasoning, while the approved
  snapshot eligibility contract forbids publishing reasoning fields.
- Options: silently republish renamed raw text; remove the section; derive a
  public explanation from already-public tier/importance/HKR booleans.
- Chosen contract: persisted snapshot schemas reject all raw reasoning keys;
  the UI derives localized `why featured` copy from public rubric facts and does
  not store or fetch the raw text.
- Alignment cost: the explanation becomes deterministic and less free-form.
- Rollback trigger: a separately reviewed public editorial field is added at
  ingestion time with its own explicit contract.
- Review result: preserves the useful affordance without defeating the privacy
  boundary by renaming private data.

### AR-006 — publisher cross-system commit point

- Problem: R2 pointer CAS and Turso outbox acknowledgement cannot be one atomic
  transaction; a post-CAS DB failure cannot leave both systems untouched.
- Chosen contract: `current.json` CAS is the commit point. Pre-commit failure
  changes neither pointer nor outbox; post-commit ack failure leaves the pointer
  advanced and outbox retained. The next run uses pointer watermark to clean the
  already-published rows without emitting a duplicate release. Ambiguous CAS is
  resolved by rereading the pointer and matching release ID.
- Alignment cost: telemetry distinguishes committed-with-pending-ack from
  pre-commit failure.
- Rollback trigger: implementation cannot prove no lost mutation across CAS,
  ambiguous responses, retry, and `id > highWater` concurrency tests.
- Review result: strict clarification of AC-003 pointer-last/idempotency; no
  acceptance statement or threshold is weakened.

### AR-007 — publisher scanned-row telemetry

- Problem: the libSQL ResultSet exposes returned rows/rows affected but not
  per-query Turso rows-read, while AC-003 requires scanned-row telemetry.
- Options: omit the field; report returned rows as scanned; emit an untyped
  estimate; emit a conservative plan-proved upper bound with provenance.
- Chosen contract: preserve `scannedRows`, set it to the conservative upper
  bound proved by the recorded EXPLAIN/index and hard query cap, and require
  `scanMeasurementKind: plan_upper_bound`. Exact database `rows_read` remains
  the AC-012 Turso from/to measurement.
- Alignment cost: publisher receipts distinguish bounded proof from billing
  metering rather than pretending the driver supplies an unavailable metric.
- Rollback trigger: libSQL adds trustworthy per-query scanned rows or the upper
  bound cannot be proven from a fixed plan/cap.
- Review result: stricter-than-actual bound preserves AC-003; no verifier or
  acceptance text is weakened.

### AR-008 — NFT-less Edge content proof

- Problem: Next 16 Edge route/middleware manifests prove artifact ownership and
  containment but webpack can inline a DB-bearing aliased dependency without
  listing it in an NFT; treating a structurally valid manifest as content purity
  would let an anonymous bundle false-green.
- Options: add a partial compiled-string heuristic in Task 4; accept manifest
  structure as sufficient; mark all selected/global Edge execution explicitly
  unverified until Task 16 runs authoritative compiled-byte and poison-runtime
  proof.
- Chosen contract: Task 4 validates exact manifest/module/artifact ownership but
  emits `unverified-edge-content` for every selected/global Edge execution path.
  Only Task 16 compiled server/Edge/client bytes plus browser/server poison runs
  may remove that hard-red state.
- Alignment cost: a valid Edge anonymous bundle cannot pass the boundary gate
  during the interim between Tasks 4 and 16, even when its manifest is perfect.
- Rollback trigger: Task 16 lands an independently mutated compiled-byte scanner
  and poison-runtime corpus that proves inlined dependency absence.
- Review result: smallest reversible fail-closed choice; preserves the frozen
  zero-public-DB constraint and avoids a heuristic false green.
