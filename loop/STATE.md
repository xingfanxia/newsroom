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
    - explicit production authorization for the R2 public-read gate
  defaulted:
    - incremental outbox publisher at 12,27,42,57 minutes
    - immutable content-addressed releases with current/previous pointers
    - local focused Conventional Commits allowed; no push
    - production cutover and user-visible semantic change require external authorization
  open_gaps: []
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
iteration: 23
phase: production-gate
current_artifact: docs/superpowers/plans/2026-07-14-r2-public-read-decoupling.md
current_criterion: AC-004
last_action: >-
  AX explicitly authorized the R2 public-read production gate at
  2026-07-15T04:16:32Z, including the Turso outbox migration, exactly one R2
  bootstrap, Vercel deploy/cutover, Cloudflare/cache/load/rollback validation,
  and the existing immutable spend caps.
next_action: >-
  Verify production env injection, write-ahead reserve the named Turso migration
  and bootstrap operations, then execute migration -> one bootstrap -> cache
  probe -> Vercel deploy/cutover -> bounded load/rollback evidence in order.
halt_cause: null
halt_scan:
  - AC-001..AC-003 pass their local criterion paths in the current final attempt.
  - AC-004 is authorized and pending the first production bootstrap/cache proof.
  - AC-005..AC-010 retain current local criterion receipts and have no remaining legal local action.
  - AC-011 is authorized and pending paired production load/control receipts.
  - AC-012 is authorized and pending publisher receipts and a clean exact >=24h Turso window.
  - AC-013 is authorized and pending >=48h stability, rollback, final metrics and shipped-doc evidence.
  - Oracle is intact: plan SHA-256 still starts ec57c55fe111 and all 13 criteria remain enforced.
stuck_counters: {}
final_verify: bun run verify:r2-public --final
oracle_change_notes:
  - >-
    Task 14 derives deterministic RSS bytes from the validated immutable release
    at the reader boundary and caches them by manifest/publish identity. It does
    not add cron-side XML derivation because reconstructing the full corpus on
    every incremental publish would violate AC-003's O(changes) constraint. The
    accepted no-public-DB invariant and RSS byte contracts are unchanged.
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
  - iteration: 12
    criterion: AC-003
    failing_evidence: >-
      Atomic publisher primitives exist but no authenticated cron, shared
      operator runtime, explicit one-shot bootstrap guard, bounded integrity
      reconciliation, or rollback-safe retention plan invokes them. AC-003 has
      no deployable operational surface and remains OPEN.
    hypothesis: >-
      One shared runtime behind authenticated cron/operator entrypoints, a
      write-ahead bootstrap ledger, read-only bounded reconciliation and a pure
      conservative retention planner can make operations runnable without
      allowing recurring full materialization or automatic pointer repair.
    edit_surface:
      - app/api/cron/publish-public/route.ts
      - lib/public-content/publisher/runtime.ts
      - lib/public-content/publisher/bootstrap.ts
      - lib/public-content/publisher/reconcile.ts
      - lib/public-content/publisher/retention.ts
      - scripts/ops/publish-public-snapshot.ts
      - scripts/ops/bootstrap-public-snapshot.ts
      - scripts/ops/reconcile-public-snapshot.ts
      - scripts/ops/run-cron.ts
      - vercel.json
      - package.json
      - tests/cron/public-snapshot-publisher.test.ts
      - tests/public-content/bootstrap-retention.test.ts
      - loop/STATE.md
    rollback: >-
      Revert iteration-12 files if cron/operator parity, exact cadence,
      bootstrap write-ahead refusal, bounded reconcile, minimum rollback
      retention, or the absence of a recurring full-materialize import cannot
      be proved without production execution.
  - iteration: 13
    criterion: AC-005
    failing_evidence: >-
      AC-003 now publishes real pointer/manifest/entity-shard contracts, but no
      request-side HTTP reader validates them, falls back from active to
      previous or warm last-good, or turns terminal corruption/timeouts into a
      typed controlled-unavailable result without a database path.
    hypothesis: >-
      One HTTPS-origin-pinned injected fetch boundary with content-addressed
      immutable caches and whole-release validation can serve logical artifacts
      and canonical state while failing active -> previous -> warm last-good ->
      typed unavailable, with no writer, DB, filesystem or secret imports.
    edit_surface:
      - lib/public-content/contract-shards.ts
      - lib/public-content/contracts.ts
      - lib/public-content/publisher/build-release.ts
      - lib/public-content/publisher/reconcile.ts
      - lib/public-content/reader/types.ts
      - lib/public-content/reader/fetch-object.ts
      - lib/public-content/reader/read-release.ts
      - lib/public-content/reader/index.ts
      - lib/public-content/testing/memory-store.ts
      - tests/public-content/reader.test.ts
      - scripts/verification/r2-public-criteria.ts
      - loop/ACCEPTANCE.md
      - loop/STATE.md
    rollback: >-
      Revert iteration-13 files if origin/path pinning, exact hashes, full
      canonical cross-references, active/previous/LKG ordering, timeout, unknown
      schemas or recursive DB/publisher-free ownership cannot be proven locally.
  - iteration: 21
    criterion: AC-013
    failing_evidence: >-
      `bun run verify:r2-public --final` is hard-coded to fail and AC-013 has no
      criterion implementation. The expected-red final-verifier test exits 1
      because its required orchestration module does not exist.
    hypothesis: >-
      A fail-closed final orchestrator can run the hermetic repository gate and
      all 13 frozen criteria in one state, require production cache/load/budget,
      48-hour stability and rollback receipts, and write a complete PASS matrix
      only after every proof succeeds.
    edit_surface:
      - scripts/verification/r2-public.ts
      - scripts/verification/r2-public-criteria.ts
      - scripts/verification/r2-public-final.ts
      - scripts/ops/verify-public-cutover.ts
      - tests/verification/r2-public-final.test.ts
      - tests/ops/public-load-budget.test.ts
      - loop/ACCEPTANCE.md
      - loop/STATE.md
      - loop/VERIFY.md
    rollback: >-
      Revert iteration-21 verifier/state files if the final command can pass
      without all 13 criteria, writes partial success, contacts production
      implicitly, or accepts stale pre-cutover docs or unmeasured rollout state.
budget:
  source: loop/PROMPT.md immutable human-authored policy
  r2_object_writes_per_run: 500
  public_http_requests_per_run: 10000
  upload_or_test_transfer_bytes_per_run: 1073741824
  bootstrap_snapshots_total: 1
  production_backed_default_tests: 0
  intentional_turso_windows: named-only
  spend_ledger:
    - run_id: production-load-cold-100x-budgeted-retry-20260715t070630z
      operation: 100x anonymous replay with one bounded network-only retry in matched cron-free load/control slots
      planned_at: 2026-07-15T06:58:00Z
      status: planned
      planned:
        r2_object_writes: 0
        public_http_requests: 10000
        transfer_bytes: 1073741824
        bootstrap_snapshots: 0
        intentional_turso_windows: 2
        deployment_id: dpl_tEFkTiZ5RYV67UP8eak4p1gsVeX6
        turso_window: production-load-cold-100x-budgeted-retry-20260715t070630z
        concurrency: 32
        load_target_start: 2026-07-15T07:06:30Z
        control_target_start: 2026-07-15T07:21:30Z
    - run_id: production-load-cold-100x-no-cron-20260715t065130z
      operation: final 100x fresh-deploy replay in matched cron-free slots with an equal named Turso control
      planned_at: 2026-07-15T06:47:00Z
      status: failed-client-network-only
      planned:
        r2_object_writes: 0
        public_http_requests: 7100
        transfer_bytes: 1073741824
        bootstrap_snapshots: 0
        intentional_turso_windows: 2
        turso_window: production-load-cold-100x-no-cron-20260715t065130z
        concurrency: 32
        load_target_start: 2026-07-15T06:51:30Z
        control_target_start: 2026-07-15T07:06:30Z
      actual:
        public_http_requests: 7100
        transfer_bytes: 504536492
        status_mismatches: 5
        unexpected_5xx: 0
        network_errors: 5
        load_delta_rows_read: 0
        reason: the cron-free Turso window proved zero DB reads, but five client connection failures had no retry allowance and failed the availability receipt
        receipt: docs/reports/r2-public-read/production-load-cold-100x-no-cron-2026-07-15-load.json
        load_from: docs/reports/r2-public-read/production-load-cold-100x-no-cron-2026-07-15-load-from.json
        load_to: docs/reports/r2-public-read/production-load-cold-100x-no-cron-2026-07-15-load-to.json
    - run_id: production-vercel-rollback-operator-20260715t064700z
      operation: deploy the authenticated unscheduled conditional pointer rollback operator before the final cold-deploy replay
      planned_at: 2026-07-15T06:47:00Z
      status: succeeded
      planned:
        r2_object_writes: 0
        public_http_requests: 2
        transfer_bytes: 2097152
        bootstrap_snapshots: 0
        intentional_turso_windows: 0
        previous_production_deployment: dpl_BxEx3ha7mC6MJWqnQBCmNBVquZTc
      actual:
        completed_at: 2026-07-15T06:48:31Z
        deployment_id: dpl_tEFkTiZ5RYV67UP8eak4p1gsVeX6
        deployment_url: newsroom-1157pmnqh-panpanmao.vercel.app
        deployed_commit: db176f2
        public_http_requests: 0
        transfer_bytes: 0
        r2_object_writes: 0
    - run_id: production-load-cold-100x-cacheable-retry-20260715t062500z
      operation: retry the 100x fresh-deploy anonymous corpus at concurrency 32 with durable network-error receipts and an equal named Turso control
      planned_at: 2026-07-15T06:25:00Z
      status: inconclusive-background-publisher
      planned:
        r2_object_writes: 0
        public_http_requests: 7100
        transfer_bytes: 1073741824
        bootstrap_snapshots: 0
        intentional_turso_windows: 2
        release_id: r49-c0d0ff3e7a4fb1c9efe5
        turso_window: production-load-cold-100x-cacheable-retry-20260715t062500z
        concurrency: 32
      actual_so_far:
        public_http_requests: 7100
        transfer_bytes: 504591800
        status_mismatches: 0
        unexpected_5xx: 0
        network_errors: 0
        load_delta_rows_read: 205
        load_started_at: 2026-07-15T06:26:33.028Z
        load_finished_at: 2026-07-15T06:31:27.178Z
        aligned_control_target: 2026-07-15T06:41:33.028Z
        receipt: docs/reports/r2-public-read/production-load-cold-100x-cacheable-retry-2026-07-15-load.json
      actual:
        public_http_requests: 7100
        transfer_bytes: 504591800
        status_mismatches: 0
        unexpected_5xx: 0
        network_errors: 0
        load_delta_rows_read: 205
        control_delta_rows_read: 2
        net_delta_rows_read: 203
        decoupled: false
        reason: the availability replay passed, but its load window crossed a publisher with pending outbox work while the aligned control publisher was a two-row noop
        turso_comparison: docs/reports/r2-public-read/production-load-cold-100x-cacheable-retry-2026-07-15-turso-comparison.json
    - run_id: production-vercel-cold-100x-retry-redeploy-20260715t062500z
      operation: force one fresh production deployment before the concurrency-32 100x retry
      planned_at: 2026-07-15T06:25:00Z
      status: succeeded
      planned:
        r2_object_writes: 0
        public_http_requests: 2
        transfer_bytes: 2097152
        bootstrap_snapshots: 0
        intentional_turso_windows: 0
        previous_production_deployment: dpl_9ckMiFAjNdbWGnQT7v9bPowbQJ8R
      actual:
        completed_at: 2026-07-15T06:26:12Z
        deployment_id: dpl_BxEx3ha7mC6MJWqnQBCmNBVquZTc
        deployment_url: newsroom-aiwj41tbg-panpanmao.vercel.app
        deployed_commit: f5fd516
        public_http_requests: 0
        transfer_bytes: 0
        r2_object_writes: 0
    - run_id: production-load-cold-100x-cacheable-20260715t061800z
      operation: 100x anonymous corpus immediately after a fresh production deployment with an equal named Turso control
      planned_at: 2026-07-15T06:18:00Z
      status: failed-runtime-and-harness
      planned:
        r2_object_writes: 0
        public_http_requests: 7100
        transfer_bytes: 1073741824
        bootstrap_snapshots: 0
        intentional_turso_windows: 2
        release_id: r49-c0d0ff3e7a4fb1c9efe5
        turso_window: production-load-cold-100x-cacheable-20260715t061800z
        concurrency: 64
      actual:
        public_http_requests: bounded-at-most-7100
        transfer_bytes: bounded-at-most-1073741824
        unexpected_5xx_observed: 1
        client_network_errors_observed: 1
        load_delta_rows_read: 45
        turso_window_valid_for_decoupling: false
        reason: concurrency 64 produced one real snapshot-unavailable response and one client connection failure; the old harness aborted before writing a load receipt
        load_from: docs/reports/r2-public-read/production-load-cold-100x-cacheable-2026-07-15-load-from.json
        load_to: docs/reports/r2-public-read/production-load-cold-100x-cacheable-2026-07-15-load-to.json
    - run_id: production-vercel-cold-100x-redeploy-20260715t061800z
      operation: redeploy the validated cacheable-shard commit to create fresh production compute before the 100x cold-deploy corpus
      planned_at: 2026-07-15T06:18:00Z
      status: succeeded
      planned:
        r2_object_writes: 0
        public_http_requests: 2
        transfer_bytes: 2097152
        bootstrap_snapshots: 0
        intentional_turso_windows: 0
        commit: 80bf408
        previous_production_deployment: dpl_HVpNDseKUt39C54JnAhqSmGDdGeQ
      actual:
        completed_at: 2026-07-15T06:18:51Z
        deployment_id: dpl_9ckMiFAjNdbWGnQT7v9bPowbQJ8R
        deployment_url: newsroom-r5rduffdm-panpanmao.vercel.app
        public_http_requests: 0
        transfer_bytes: 0
        r2_object_writes: 0
    - run_id: production-load-cache-miss-10x-cacheable-retry-20260715t061500z
      operation: retry the clean 10x cache-miss anonymous corpus and equal Turso control away from publisher cadence
      planned_at: 2026-07-15T06:15:00Z
      status: succeeded
      planned:
        r2_object_writes: 0
        public_http_requests: 710
        transfer_bytes: 268435456
        bootstrap_snapshots: 0
        intentional_turso_windows: 2
        deployment_id: dpl_HVpNDseKUt39C54JnAhqSmGDdGeQ
        release_id: r49-c0d0ff3e7a4fb1c9efe5
        turso_window: production-load-cache-miss-10x-cacheable-retry-20260715t061500z
      actual:
        public_http_requests: 710
        transfer_bytes: 50459180
        status_mismatches: 0
        unexpected_5xx: 0
        load_delta_rows_read: 0
        control_delta_rows_read: 0
        net_delta_rows_read: 0
        decoupled: true
        receipt: docs/reports/r2-public-read/production-load-cache-miss-10x-cacheable-retry-2026-07-15-load.json
        turso_comparison: docs/reports/r2-public-read/production-load-cache-miss-10x-cacheable-retry-2026-07-15-turso-comparison.json
    - run_id: production-load-cache-miss-10x-cacheable-20260715t061100z
      operation: 10x anonymous cache-miss corpus against the 128-bucket cacheable release with an equal named Turso control
      planned_at: 2026-07-15T06:11:00Z
      status: inconclusive-control-noise
      planned:
        r2_object_writes: 0
        public_http_requests: 710
        transfer_bytes: 268435456
        bootstrap_snapshots: 0
        intentional_turso_windows: 2
        deployment_id: dpl_HVpNDseKUt39C54JnAhqSmGDdGeQ
        release_id: r49-c0d0ff3e7a4fb1c9efe5
        turso_window: production-load-cache-miss-10x-cacheable-20260715t061100z
      actual:
        public_http_requests: 710
        transfer_bytes: 50459180
        status_mismatches: 0
        unexpected_5xx: 0
        load_delta_rows_read: 0
        control_delta_rows_read: 2
        net_delta_rows_read: -2
        reason: the load was DB-zero but the equal control overlapped a background publisher; exact-zero acceptance requires a fresh pair
        receipt: docs/reports/r2-public-read/production-load-cache-miss-10x-cacheable-2026-07-15-load.json
        turso_comparison: docs/reports/r2-public-read/production-load-cache-miss-10x-cacheable-2026-07-15-turso-comparison.json
    - run_id: production-r2-repartition-128-publisher-20260715t060900z
      operation: run one no-change publisher migration from 16 oversized buckets to 128 cacheable buckets and verify pointer/manifest
      planned_at: 2026-07-15T06:09:00Z
      status: succeeded
      planned:
        r2_object_writes: 400
        public_http_requests: 5
        transfer_bytes: 536870912
        bootstrap_snapshots: 0
        intentional_turso_windows: 0
        from_release_id: r34-99bce1c809ccc04163e7
        expected_release_id: r34-60124bb056a26b9f5e08
        projected_r2_writes: 311
      actual:
        completed_at: 2026-07-15T06:09:39Z
        publisher_run_id: p-20260715060836516-4d0e0577-e3a3-4f8a-a05d-747743e93fc7
        from_release_id: r34-99bce1c809ccc04163e7
        active_release_id: r49-c0d0ff3e7a4fb1c9efe5
        source_watermark: 49
        r2_object_write_attempts: 311
        uploaded_artifacts: 15
        reused_artifacts: 293
        uploaded_bytes: 11209051
        reused_bytes: 83320283
        public_http_requests: 3
        transfer_bytes: 220000000
        transfer_measurement: conservative upper bound below the reserved 512 MiB
        manifest_artifacts: 310
        numeric_artifacts: 308
        numeric_shard_count: 128
        maximum_artifact_bytes: 923637
        pointer_etag: W/"871d48f06ea7a62ffed4d7eaf85575e2"
        receipt: docs/reports/r2-public-read/production-r2-repartition-128-publisher-2026-07-15.json
    - run_id: production-vercel-cacheable-shards-hotfix-20260715t060900z
      operation: deploy 128 cacheable numeric shards, explicit manifest shard-count metadata and a 30-second bounded R2 fetch timeout
      planned_at: 2026-07-15T06:09:00Z
      status: succeeded
      planned:
        r2_object_writes: 0
        public_http_requests: 5
        transfer_bytes: 5242880
        bootstrap_snapshots: 0
        intentional_turso_windows: 0
        previous_production_deployment: dpl_GNjr66SUnJQHL915PzCHS2LHaDrv
      actual:
        completed_at: 2026-07-15T06:10:20Z
        deployment_id: dpl_HVpNDseKUt39C54JnAhqSmGDdGeQ
        deployment_url: newsroom-gslux1qth-panpanmao.vercel.app
        deployed_commit: 80bf408
        public_http_requests: 1
        transfer_bytes: 363364
        r2_object_writes: 0
        html_status: 200
        html_seconds: 8.116781
    - run_id: production-r2-repartition-128-preflight-20260715t060700z
      operation: read-only reconstruction of the active 16-bucket release into the cacheable 128-bucket layout
      planned_at: 2026-07-15T06:07:00Z
      status: succeeded
      planned:
        r2_object_writes: 0
        public_http_requests: 60
        transfer_bytes: 134217728
        bootstrap_snapshots: 0
        intentional_turso_windows: 0
        active_release_id: r34-99bce1c809ccc04163e7
        expected_maximum_r2_writes: 500
        target_artifact_bytes: 2000000
      actual:
        completed_at: 2026-07-15T06:08:20Z
        public_http_requests: 50
        transfer_bytes: 94310425
        r2_object_writes: 0
        loaded_artifacts: 48
        built_artifacts: 308
        manifest_artifacts: 310
        numeric_artifacts: 308
        numeric_shard_count: 128
        maximum_artifact_bytes: 923637
        projected_r2_writes: 311
        built_release_id: r34-60124bb056a26b9f5e08
    - run_id: production-pointer-capacity-rollback-20260715t060200z
      operation: conditionally roll the active pointer from the oversized 16-bucket release back to the last known 128-bucket release before the timeout hotfix deployment
      planned_at: 2026-07-15T06:02:00Z
      status: not-executed-superseded
      planned:
        r2_object_writes: 2
        public_http_requests: 5
        transfer_bytes: 1048576
        bootstrap_snapshots: 0
        intentional_turso_windows: 0
        from_release_id: r34-99bce1c809ccc04163e7
        rollback_release_id: r34-25092d7f5022cc16d278
      actual:
        r2_object_writes: 0
        public_http_requests: 0
        transfer_bytes: 0
        reason: local S3 credentials are intentionally non-exportable; superseded by a preflighted publisher migration to a new 128-bucket release
    - run_id: production-vercel-noop-repartition-hotfix-20260715t055300z
      operation: deploy the no-change migration reachability fix and verify the publisher route is live
      planned_at: 2026-07-15T05:53:00Z
      status: succeeded
      planned:
        r2_object_writes: 0
        public_http_requests: 5
        transfer_bytes: 5242880
        bootstrap_snapshots: 0
        intentional_turso_windows: 0
        previous_production_deployment: dpl_4zPFdTxx9LsAa3r72Yo9tCC9GMth
      actual:
        completed_at: 2026-07-15T05:53:56Z
        deployment_id: dpl_GNjr66SUnJQHL915PzCHS2LHaDrv
        deployment_url: newsroom-mtak1qlhr-panpanmao.vercel.app
        deployed_commit: dbf3cde
        public_http_requests: 1
        transfer_bytes: 329094
        r2_object_writes: 0
        html_status: 200
    - run_id: production-vercel-repartition-20260715t053700z
      operation: deploy the backward-compatible 16-bucket reader/writer and verify representative production paths
      planned_at: 2026-07-15T05:37:00Z
      status: succeeded
      planned:
        r2_object_writes: 0
        public_http_requests: 10
        transfer_bytes: 10485760
        bootstrap_snapshots: 0
        intentional_turso_windows: 0
        previous_production_deployment: dpl_6K4t8Zy9fDLJuJJAdt9xnPQEXSHL
      actual:
        completed_at: 2026-07-15T05:40:34Z
        deployment_id: dpl_4zPFdTxx9LsAa3r72Yo9tCC9GMth
        deployment_url: newsroom-4f15ggq79-panpanmao.vercel.app
        production_origin: https://news.ax0x.ai
        public_http_requests: 9
        transfer_bytes: 931314
        r2_object_writes: 0
        intentional_turso_windows: 0
        html_status: 200
        rsc_status: 200
        json_status: 200
        rss_status: 200
    - run_id: production-r2-repartition-publisher-20260715t054600z
      operation: allow one normal incremental publisher tick to migrate the active numeric layout from 128 buckets to 16, then verify the committed pointer and manifest
      planned_at: 2026-07-15T05:46:00Z
      status: succeeded
      planned:
        r2_object_writes: 60
        public_http_requests: 5
        transfer_bytes: 10485760
        bootstrap_snapshots: 0
        intentional_turso_windows: 0
        deployment_id: dpl_4zPFdTxx9LsAa3r72Yo9tCC9GMth
        prior_release_id: r34-25092d7f5022cc16d278
        expected_manifest_artifacts: 50
        maximum_numeric_bucket: 0f
      actual:
        completed_at: 2026-07-15T05:55:25Z
        initial_noop_run_id: p-20260715055041410-ad8a6299-7c7c-4506-8fb4-d442f771e64b
        publisher_run_id: p-20260715055407490-4deeb7c9-3f21-4d79-a875-501ab67b1a88
        prior_release_id: r34-25092d7f5022cc16d278
        active_release_id: r34-99bce1c809ccc04163e7
        source_watermark: 34
        r2_object_writes: 50
        public_http_requests: 4
        transfer_bytes: 284000000
        transfer_measurement: conservative upper bound covering old-artifact reads, new uploads and readback verification
        reservation_note: the 10 MiB verification reservation understated the one-time internal R2 migration transfer, but the measured upper bound remained below the governing 1 GiB per-run cap
        uploaded_artifacts: 48
        uploaded_bytes: 94294113
        manifest_artifacts: 50
        numeric_artifacts: 48
        legacy_high_bucket_names: 0
        maximum_numeric_bucket: 0f
        pointer_etag: W/"7141d8572948266ddbfc70ef2947f1f4"
        receipt: docs/reports/r2-public-read/production-r2-repartition-publisher-2026-07-15.json
    - run_id: production-r2-repartition-preflight-20260715t053300z
      operation: read-only reconstruction of the active 128-bucket release into the planned 16-bucket layout
      planned_at: 2026-07-15T05:33:00Z
      status: succeeded
      planned:
        r2_object_writes: 0
        public_http_requests: 320
        transfer_bytes: 134217728
        bootstrap_snapshots: 0
        intentional_turso_windows: 0
        active_release: r34-25092d7f5022cc16d278
      actual:
        public_http_requests: 308
        transfer_bytes: 94319426
        r2_object_writes: 0
        loaded_artifacts: 308
        built_artifacts: 48
        manifest_artifacts: 50
        projected_publish_writes: 51
        max_artifact_bytes: 6218222
        item_count: 8743
        event_count: 462
        newsletter_count: 71
        legacy_high_bucket_names: 0
    - run_id: production-load-warm-1x-retry-20260715t052300z
      operation: 1x warm anonymous corpus with release-backed samples and equal named Turso control
      planned_at: 2026-07-15T05:23:00Z
      status: succeeded
      planned:
        r2_object_writes: 0
        public_http_requests: 71
        transfer_bytes: 33554432
        bootstrap_snapshots: 0
        intentional_turso_windows: 2
        deployment_id: dpl_6K4t8Zy9fDLJuJJAdt9xnPQEXSHL
        turso_window: production-load-warm-1x-retry-20260715t052300z
      actual:
        public_http_requests: 71
        transfer_bytes: 5046932
        status_mismatches: 0
        unexpected_5xx: 0
        load_delta_rows_read: 0
        control_delta_rows_read: 0
        net_delta_rows_read: 0
        decoupled: true
        receipt: docs/reports/r2-public-read/production-load-warm-1x-retry-2026-07-15-load.json
        turso_comparison: docs/reports/r2-public-read/production-load-warm-1x-retry-2026-07-15-turso-comparison.json
    - run_id: production-load-cache-miss-10x-repartition-20260715t054400z
      operation: 10x cache-miss anonymous corpus against the 16-bucket release with an equal named Turso control
      planned_at: 2026-07-15T05:44:00Z
      status: failed-runtime-capacity
      planned:
        r2_object_writes: 0
        public_http_requests: 710
        transfer_bytes: 268435456
        bootstrap_snapshots: 0
        intentional_turso_windows: 2
        deployment_id: dpl_4zPFdTxx9LsAa3r72Yo9tCC9GMth
        required_release_layout: 16-bucket
        turso_window: production-load-cache-miss-10x-repartition-20260715t054400z
      actual:
        public_http_requests: 710
        transfer_bytes: 42663275
        status_mismatches: 33
        unexpected_5xx: 33
        load_delta_rows_read: 0
        net_db_pressure_observed: 0
        reason: 16-bucket artifacts are 7-8 MiB over HTTP and exceed the 2 MiB Next.js Data Cache item limit, forcing each cold instance to reconstruct the full 94 MiB state
        receipt: docs/reports/r2-public-read/production-load-cache-miss-10x-repartition-2026-07-15-load.json
        failed_window: docs/reports/r2-public-read/production-load-cache-miss-10x-repartition-2026-07-15-failed-window.json
    - run_id: production-load-cold-100x-20260715t051700z
      operation: 100x cold-deploy anonymous corpus with equal named Turso control
      planned_at: 2026-07-15T05:17:00Z
      status: not-executed-superseded
      planned:
        r2_object_writes: 0
        public_http_requests: 7100
        transfer_bytes: 1073741824
        bootstrap_snapshots: 0
        intentional_turso_windows: 2
        deployment_id: dpl_6K4t8Zy9fDLJuJJAdt9xnPQEXSHL
        turso_window: production-load-cold-100x-20260715t051700z
      actual:
        public_http_requests: 0
        transfer_bytes: 0
        reason: superseded after the old 128-shard reader failed its prerequisite 10x capacity test; replacement run targets the cacheable timeout-fixed deployment
    - run_id: production-load-cache-miss-10x-20260715t051700z
      operation: 10x cache-miss anonymous corpus with equal named Turso control
      planned_at: 2026-07-15T05:17:00Z
      status: failed-runtime-capacity
      planned:
        r2_object_writes: 0
        public_http_requests: 710
        transfer_bytes: 268435456
        bootstrap_snapshots: 0
        intentional_turso_windows: 2
        deployment_id: dpl_6K4t8Zy9fDLJuJJAdt9xnPQEXSHL
        turso_window: production-load-cache-miss-10x-20260715t051700z
        cache_purge_urls:
          - https://content.ax0x.ai/newsroom/v1/current.json
          - https://content.ax0x.ai/newsroom/v1/releases/r0-8c1c86004a59bbcb8eed/manifest.json
      actual:
        cache_purge_performed: false
        cache_miss_method: pointer TTL expiry after the temporary Cache Rules token had been removed
        public_http_requests: 710
        transfer_bytes: 47507361
        status_mismatches: 6
        unexpected_5xx: 6
        load_delta_rows_read: 0
        reason: Cold Vercel instances timed out while reconstructing the 309-artifact canonical state; no DB fallback occurred
        receipt: docs/reports/r2-public-read/production-load-cache-miss-10x-2026-07-15-load.json
        failed_window: docs/reports/r2-public-read/production-load-cache-miss-10x-2026-07-15-failed-window.json
    - run_id: production-load-warm-1x-20260715t051700z
      operation: 1x warm anonymous corpus with equal named Turso control
      planned_at: 2026-07-15T05:17:00Z
      status: failed-fixture-precondition
      planned:
        r2_object_writes: 0
        public_http_requests: 71
        transfer_bytes: 33554432
        bootstrap_snapshots: 0
        intentional_turso_windows: 2
        deployment_id: dpl_6K4t8Zy9fDLJuJJAdt9xnPQEXSHL
        turso_window: production-load-warm-1x-20260715t051700z
      actual:
        public_http_requests: 71
        transfer_bytes: 4874394
        status_mismatches: 8
        unexpected_5xx: 0
        turso_delta_rows_read: 64
        reason: Fixed local-fixture item, podcast, and daily identifiers were absent from the production release; production correctly returned 404
        receipt: docs/reports/r2-public-read/production-load-warm-1x-2026-07-15-load.json
        failed_window: docs/reports/r2-public-read/production-load-warm-1x-2026-07-15-failed-window.json
    - run_id: production-vercel-cutover-20260715t051149z
      operation: production Vercel deployment, public-origin cutover, representative probes, and bounded rollback if needed
      planned_at: 2026-07-15T05:11:49Z
      status: succeeded
      planned:
        r2_object_writes: 0
        public_http_requests: 10
        transfer_bytes: 10485760
        bootstrap_snapshots: 0
        intentional_turso_windows: 0
        commit: e2e80f4753b175934910ebeeb073dd9c4845b514
        previous_production_deployment: dpl_CzkjVD8GwsiX5HhhZd7LTxWdL91h
      actual:
        deployment_id: dpl_6K4t8Zy9fDLJuJJAdt9xnPQEXSHL
        deployment_url: newsroom-8w3zc1lb1-panpanmao.vercel.app
        deployed_commit: ab753d7
        public_http_requests: 4
        transfer_bytes: 457880
        statuses:
          html: 200
          rsc: 200
          json: 200
          rss: 200
        cutover_performed: true
        rollback_performed: false
        receipt: docs/reports/r2-public-read/production-vercel-cutover-2026-07-15.md
    - run_id: production-vercel-preview-canary-20260715t050741z
      operation: deploy and probe a protected Vercel preview against the production public R2 origin
      planned_at: 2026-07-15T05:07:41Z
      status: succeeded
      planned:
        r2_object_writes: 0
        public_http_requests: 10
        transfer_bytes: 10485760
        bootstrap_snapshots: 0
        intentional_turso_windows: 0
        commit: e2e80f4753b175934910ebeeb073dd9c4845b514
        previous_production_deployment: dpl_CzkjVD8GwsiX5HhhZd7LTxWdL91h
      actual:
        deployment_id: dpl_2Lmw4rcCwASKHrQSWQRsucUFdTxj
        deployment_url: newsroom-kuvrq817i-panpanmao.vercel.app
        public_http_requests: 4
        transfer_bytes: 457880
        statuses:
          html: 200
          rsc: 200
          json: 200
          rss: 200
        cutover_performed: false
    - run_id: production-vercel-staged-canary-20260715t045942z
      operation: authenticated staged-deployment HTML/RSC/JSON/RSS probes
      planned_at: 2026-07-15T04:59:42Z
      status: blocked-before-canary
      planned:
        r2_object_writes: 0
        public_http_requests: 10
        transfer_bytes: 10485760
        bootstrap_snapshots: 0
        intentional_turso_windows: 0
        deployment_id: dpl_2Ny68n8xMWXDfKXArahoNw4pVpGZ
        commit: d7361185c304fbd463ed3a7e4593205b3b0462f5
        previous_production_deployment: dpl_CzkjVD8GwsiX5HhhZd7LTxWdL91h
      actual:
        public_http_requests: 3
        transfer_bytes: 21879
        cutover_performed: false
        reason: Vercel blocked the deployment because the local-only Git author email was not associated with the team account
    - run_id: production-r2-bootstrap-20260715t044216z
      operation: exactly one conditional R2 bootstrap through an ephemeral Wrangler remote-dev bridge
      planned_at: 2026-07-15T04:42:16Z
      status: completed
      planned:
        r2_object_writes: 312
        public_http_requests: 1000
        transfer_bytes: 1073741824
        bootstrap_snapshots: 1
        intentional_turso_windows: 0
        release_id: r0-8c1c86004a59bbcb8eed
        note: >-
          Local prebuild produced 309 immutable artifacts; manifest, pointer and
          run receipt bring the exact expected write count to 312. The bridge
          uses R2 binding conditional headers and is removed after the run.
      actual:
        started_at: 2026-07-15T04:44:33Z
        finished_at: 2026-07-15T04:47:36Z
        r2_object_writes: 312
        public_http_requests: 0
        bridge_http_requests: 625
        transfer_bytes: 188504614
        uploaded_bytes: 94252307
        bootstrap_snapshots: 1
        intentional_turso_windows: 0
        release_id: r0-8c1c86004a59bbcb8eed
        run_id: p-20260715044433559-f7a9a028-3b75-4e1f-8320-2905c7e471c9
        pointer_bytes: 305
        manifest_bytes: 96947
        receipt_bytes: 636
        immutable_artifacts_uploaded: 309
        immutable_artifact_bytes: 94154419
        spend_ledger_used: 1
        bridge_removed: true
        receipt: docs/reports/r2-public-read/production-r2-bootstrap-2026-07-15.md
    - run_id: production-r2-cache-20260715t044900z
      operation: public Cloudflare pointer and immutable manifest MISS/HIT probe
      planned_at: 2026-07-15T04:49:00Z
      status: completed
      planned:
        r2_object_writes: 0
        public_http_requests: 4
        transfer_bytes: 1048576
        bootstrap_snapshots: 0
        intentional_turso_windows: 0
      actual:
        captured_at: 2026-07-15T04:50:31.149Z
        r2_object_writes: 0
        public_http_requests: 4
        transfer_bytes: 194504
        bootstrap_snapshots: 0
        intentional_turso_windows: 0
        pointer_cache_sequence: MISS-HIT
        pointer_second_age: 1
        immutable_cache_sequence: MISS-HIT
        immutable_second_age: 1
        stable_etags: true
        cors: "*"
        receipt: docs/reports/r2-public-read/production-r2-cache-2026-07-15.json
    - run_id: production-bootstrap-export-retry2-20260715t043413z
      operation: canonical public-state export after narrow historical locator allowlist fix
      planned_at: 2026-07-15T04:34:13Z
      status: completed
      planned:
        r2_object_writes: 0
        public_http_requests: 0
        transfer_bytes: 1073741824
        bootstrap_snapshots: 0
        intentional_turso_windows: 1
        turso_scope: >-
          one exact usage-before/usage-after window containing only the
          paginated public-schema bootstrap export
      actual:
        started_at: 2026-07-15T04:34:38Z
        finished_at: 2026-07-15T04:37:40Z
        r2_object_writes: 0
        public_http_requests: 0
        transfer_bytes: 94124402
        bootstrap_snapshots: 0
        intentional_turso_windows: 1
        rows_read_before: 615049007
        rows_read_after: 615114307
        rows_read_delta: 65300
        rows_written_before: 4305154
        rows_written_after: 4305154
        rows_written_delta: 0
        source_watermark: 0
        state_sha256: ea6036d17022e3c04febe0b542adc6eef09e9928aa902f519766d30f240442ed
        counts:
          items: 8730
          events: 462
          sources: 55
          newsletters: 70
          policies: 1
        query_count: 81
        returned_rows: 37358
        output_mode: "0600"
        receipt: docs/reports/r2-public-read/production-bootstrap-export-2026-07-15.md
    - run_id: production-bootstrap-export-20260715t042454z
      operation: one-shot canonical public-state export from production Turso
      planned_at: 2026-07-15T04:24:54Z
      status: failed
      planned:
        r2_object_writes: 0
        public_http_requests: 0
        transfer_bytes: 1073741824
        bootstrap_snapshots: 0
        intentional_turso_windows: 1
        turso_scope: >-
          one exact usage-before/usage-after window containing only the
          paginated public-schema bootstrap export
      actual:
        observed_through: 2026-07-15T04:28:44Z
        r2_object_writes: 0
        public_http_requests: 0
        output_transfer_bytes: 0
        bootstrap_snapshots: 0
        intentional_turso_windows: 1
        output_file_created: false
        rows_read_nearest_prior: 614852565
        rows_read_observed_after: 614942391
        rows_read_upper_bound_delta: 89826
        rows_written_nearest_prior: 4304222
        rows_written_observed_after: 4305149
        note: >-
          The exporter failed closed before writing its exclusive output. Its
          detached tool session lost the exact error and exact in-command
          before/after values; the recorded delta is a conservative upper bound
          that includes concurrent background production work and is not used
          as a clean-window measurement.
    - run_id: production-bootstrap-export-retry1-20260715t042844z
      operation: retry one-shot canonical public-state export with attached output capture
      planned_at: 2026-07-15T04:28:44Z
      status: failed
      planned:
        r2_object_writes: 0
        public_http_requests: 0
        transfer_bytes: 1073741824
        bootstrap_snapshots: 0
        intentional_turso_windows: 1
        turso_scope: >-
          one exact usage-before/usage-after window containing only the
          paginated public-schema bootstrap export retry
      actual:
        started_at: 2026-07-15T04:29:26Z
        finished_at: 2026-07-15T04:32:52Z
        r2_object_writes: 0
        public_http_requests: 0
        output_transfer_bytes: 0
        bootstrap_snapshots: 0
        intentional_turso_windows: 1
        rows_read_before: 614942391
        rows_read_after: 615030507
        rows_read_delta: 88116
        rows_written_before: 4305149
        rows_written_after: 4305149
        rows_written_delta: 0
        output_file_created: false
        failure: public source internal locator is not allowlisted
    - run_id: production-internal-source-diagnostic-20260715t043252z
      operation: identify production internal source locators rejected by public schema
      planned_at: 2026-07-15T04:32:52Z
      status: completed
      planned:
        r2_object_writes: 0
        public_http_requests: 0
        transfer_bytes: 65536
        bootstrap_snapshots: 0
        intentional_turso_windows: 1
        turso_scope: >-
          one read-only indexed source query limited to internal:// locators
      actual:
        started_at: 2026-07-15T04:33:26Z
        finished_at: 2026-07-15T04:33:27Z
        r2_object_writes: 0
        public_http_requests: 0
        transfer_bytes: 191
        bootstrap_snapshots: 0
        intentional_turso_windows: 1
        rows_read_before: 615048942
        rows_read_after: 615048942
        rows_read_delta: 0
        rows_written_before: 4305149
        rows_written_after: 4305149
        rows_written_delta: 0
        result: >-
          Found the two existing allowlisted locators plus disabled historical
          source x-ai-watchlist -> internal://x-watchlist. The latter is now
          narrowly allowlisted; arbitrary internal:// URLs remain rejected.
    - run_id: production-outbox-migration-20260715t042356z
      operation: checksummed production Turso public-content outbox migration
      planned_at: 2026-07-15T04:23:56Z
      status: completed
      planned:
        r2_object_writes: 0
        public_http_requests: 0
        transfer_bytes: 0
        bootstrap_snapshots: 0
        intentional_turso_windows: 1
        turso_scope: >-
          one exact usage-before/usage-after window containing only the
          idempotent 20260714_public_content_outbox_v1 migration
      actual:
        started_at: 2026-07-15T04:24:24Z
        finished_at: 2026-07-15T04:24:26Z
        r2_object_writes: 0
        public_http_requests: 0
        transfer_bytes: 0
        bootstrap_snapshots: 0
        intentional_turso_windows: 1
        rows_read_before: 614852565
        rows_read_after: 614852565
        rows_read_delta: 0
        rows_written_before: 4304222
        rows_written_after: 4304222
        rows_written_delta: 0
        migration_name: 20260714_public_content_outbox_v1
        migration_checksum: 10137a90e335ad8ae8e62e47df1b5e7e5b99c73a811d3ef897ce301eea946bfe
        applied: true
        receipt: docs/reports/r2-public-read/production-outbox-migration-2026-07-15.md
    - run_id: ac004-current-head-20260715t011411z
      operation: HEAD https://content.ax0x.ai/newsroom/v1/current.json
      planned_at: 2026-07-15T01:14:11Z
      status: completed
      planned:
        r2_object_writes: 0
        public_http_requests: 1
        transfer_bytes: 65536
        bootstrap_snapshots: 0
        intentional_turso_windows: 0
      actual:
        captured_at: 2026-07-15T01:14:46Z
        r2_object_writes: 0
        public_http_requests: 1
        response_body_bytes: 0
        bootstrap_snapshots: 0
        intentional_turso_windows: 0
        http_status: 404
        cf_cache_status: MISS
external_authorizations:
  - authorized_at: 2026-07-15T04:16:32Z
    scope: >-
      R2 public-read production gate, including Turso outbox migration, exactly
      one R2 bootstrap, Vercel deploy/cutover, Cloudflare/cache/load/rollback
      validation, under the existing immutable budget caps.
    source: explicit AX user message
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
  - 2026-07-15: budgeted AC-004 public pointer HEAD returned 404/MISS with one request and zero body bytes, confirming no production bootstrap
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
  - iteration: 12
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
        Limits DB/R2 writer construction to publisher runtime entrypoints and
        adds no anonymous route import or fallback.
      P-rows-hard: >-
        Recurring cron calls only the incremental source; bootstrap state is an
        explicit one-shot operator input and cannot be reached by cron.
      P-rows-ideal: >-
        Keeps reconciliation R2-only and bounded so daily integrity work adds
        no Turso floor.
      P-safe-tests: >-
        Uses injected cron runners, memory object stores and pure planners plus
        focused source assertions, typecheck and lint.
      P-architecture-api: >-
        Shares one runtime between cron and operators while keeping bootstrap,
        reconcile and retention as separate narrow capabilities.
      P-metered-cap: >-
        No script or route is executed against external services; all R2,
        Turso, Cloudflare, deploy, bootstrap, publish and request spend is zero.
  - iteration: 13
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
        Reader source may import only neutral public contracts/canonical logic
        and injected fetch; DB, libSQL and publisher modules are forbidden.
      P-rows-hard: >-
        Every failure branch terminates at previous/LKG/typed unavailable and
        cannot request a DB fallback.
      P-rows-ideal: >-
        Immutable objects are cached by release/hash so origin misses do not
        create any Turso or repeated R2 fetch amplification.
      P-safe-tests: >-
        Uses an in-memory HTTPS fetch surface, fake timeouts and poison sentinels
        with one focused reader suite plus source-boundary/typecheck.
      P-architecture-api: >-
        Moves shared persisted shard parsing out of publisher ownership before
        reader use, preserving the recursive import boundary.
      P-metered-cap: >-
        No public-domain fetch or cloud request runs; all traffic and external
        transfer remain zero.
  - iteration: 21
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
        Requires the resumed audit to keep AC-004/AC-011/AC-012 open until real
        production receipts prove the R2 cutover and zero load-correlated reads.
      P-rows-hard: >-
        Keeps the exact clean >=24h threshold as a terminal production gate;
        local green evidence cannot substitute for it.
      P-rows-ideal: >-
        Preserves the preferred <10M/month attribution requirement after the
        hard <100M/month line is measured.
      P-safe-tests: >-
        Uses only the hermetic criterion/final verifier paths; no production-
        backed default suite or ambient credential loading is allowed.
      P-architecture-api: >-
        Rechecks source/NFT ownership through the frozen verifier rather than
        adding another review layer.
      P-metered-cap: >-
        This resumed pass is local/read-only. No R2 write, public replay, Turso
        window, migration, bootstrap, deploy, cutover, DNS, or cache mutation is
        authorized by goal invocation alone.
  - iteration: 22
    consulted_at: 2026-07-15
    ids:
      - P-public-db-zero
      - P-rows-hard
      - P-rows-ideal
      - P-safe-tests
      - P-architecture-api
      - P-metered-cap
    influence:
      P-public-db-zero: >-
        Limits this pass to observing whether the public R2 pointer exists; no
        application route, database path, or fallback is exercised.
      P-rows-hard: >-
        No-effect: the HEAD probe does not access Turso or claim a budget result.
      P-rows-ideal: >-
        No-effect: no publisher or database work is run.
      P-safe-tests: >-
        No test suite is repeated; the probe records only response metadata.
      P-architecture-api: >-
        No-effect: no source or bundle ownership changes in this pass.
      P-metered-cap: >-
        Reserves exactly one public HEAD request and 64 KiB transfer before the
        request; all writes, bootstraps and Turso windows remain zero.
  - iteration: 23
    consulted_at: 2026-07-15
    ids:
      - P-public-db-zero
      - P-rows-hard
      - P-rows-ideal
      - P-safe-tests
      - P-architecture-api
      - P-metered-cap
    influence:
      P-public-db-zero: >-
        Keeps the production cutover fail-closed on R2 with no anonymous Turso
        fallback during bootstrap, deploy, cache-miss, load, or rollback paths.
      P-rows-hard: >-
        Requires an exact named clean window of at least 24 hours after cutover
        before the hard <100M/month criterion can pass.
      P-rows-ideal: >-
        Preserves residual attribution and the preferred <10M/month verdict
        after anonymous traffic is decoupled.
      P-safe-tests: >-
        Reuses the unchanged passing local gate and runs only production-specific
        evidence commands until the deployed diff changes.
      P-architecture-api: >-
        No source-boundary change is planned; any bootstrap exporter must remain
        an operator-only DB-owning surface and emit the frozen public contract.
      P-metered-cap: >-
        Requires a write-ahead ledger before each Turso/R2/public integration
        run and enforces one bootstrap, <=500 writes, <=10000 requests, and
        <=1 GiB transfer per run.
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
