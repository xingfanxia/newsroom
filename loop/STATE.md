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
iteration: 1
phase: implementation
current_artifact: docs/superpowers/plans/2026-07-14-r2-public-read-decoupling.md
current_criterion: AC-001
last_action: >-
  Launched the approved goal, confirmed the known-red unsafe test and anonymous
  libSQL bundle baselines, read the applicable Next.js 16.2.4 and Bun environment
  authority, created the feature branch, wrote the 18-task TDD execution plan,
  and passed independent plan review after resolving all dependency/oracle
  findings. No production-backed test or external mutation was run.
next_action: >-
  Commit the canonical goal bootstrap, move the feature branch into the external
  isolated worktree, initialize the SDD ledger, and execute Task 1 for AC-001
  red-to-green before any package-wide test command.
halt_cause: null
halt_scan: []
stuck_counters: {}
final_verify: bun run verify:r2-public --final
oracle_change_notes: []
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
- Review question: approve, modify, or abort this plan before launching `/goal`.

### AR-002 — publisher cadence

- Problem: frequent full rebuilds would merely move DB pressure from users to cron.
- Options: three full builds/day; frequent full builds; 15-minute incremental outbox.
- Chosen contract: 15-minute coalesced incremental outbox plus one bounded daily reconciliation.
- Alignment cost: more implementation complexity and trigger/outbox tests.
- Rollback trigger: measured publisher projection exceeds 5M rows/month or
  outbox correctness cannot be proven.
- Review question: approve, modify, or abort this plan before launching `/goal`.

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
