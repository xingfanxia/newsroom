# R2 Public-Read Decoupling Implementation Plan

> **Execution:** Use `superpowers:subagent-driven-development` one task at a
> time. Every behavior change is test-first, every accepted task ends in one
> focused Conventional Commit, and the task reviewer must approve both spec and
> quality before the next task starts.

**Goal:** Make anonymous traffic independent of Turso. Every public HTML, RSC,
JSON, RSS, GET and implicit HEAD request must read a validated R2 snapshot or
fail stale/503; request volume must never create request-time database reads.

**Root cause:** The current cache layer is traffic-dependent. On a CDN or Next
cache miss, public adapters call DB-owning modules before computing ETags, and
the anonymous HTML/RSC graph also imports Turso directly. This means more users,
bots, query variants, deploys, or prefetches produce more rows read. The current
test command compounds the risk by automatically loading production secrets.

**Architecture:** Content cron mutations append to a checksummed Turso outbox.
A bounded coalescing publisher patches normalized canonical state, derives
public artifacts in memory, uploads immutable content-addressed objects and a
manifest, then conditionally advances `current.json`. Public consumers use one
strict HTTP reader over `content.ax0x.ai`. Reader and query modules have no DB or
publisher imports. Private/authenticated/mutation paths retain Turso ownership.

**Stack:** Next.js 16.2.4 App Router, Bun, TypeScript, Zod, libSQL/Turso,
Cloudflare R2 S3 API via `@aws-sdk/client-s3`, Cloudflare CDN, Vercel cron.

**Authority:** `loop/PROMPT.md`, `loop/ACCEPTANCE.md`, and
`docs/R2-PUBLIC-READ-PLAN-2026-07-14.md`. This plan is an execution map, not a
replacement acceptance source.

## Global constraints

- Never run a command that can load `.env.local` until Task 2 proves AC-001.
- Before AC-001 is green, focused tests use `bun --no-env-file test <file>`.
- After AC-001, all default tests run through the hermetic wrapper.
- Never print, copy, commit, or pass production secret values to an agent.
- No production publish, DB migration, Vercel deploy/cutover, cache-rule/DNS
  mutation, bootstrap, or load replay without the explicit external gate.
- Local tests use file-backed temporary libSQL and an in-memory object store.
- No anonymous request path may dual-read or fall back to Turso. Snapshot
  failure means current, previous/last-known-good, then controlled 503.
- `current.json` CAS is the cross-system commit point. Pre-commit failures leave
  pointer/outbox unchanged. Post-commit ack failure retains outbox rows and the
  next run cleans them idempotently from the pointer watermark.
- Snapshot Zod objects are strict. Unknown versions/keys fail closed. Raw
  reasoning, raw RSS body, embeddings, diagnostics, secrets, feedback, saved
  data and user settings are forbidden persisted fields.
- Anonymous semantic search returns HTTP 422 with
  `{ "error": "semantic_search_requires_auth" }`; bearer v1/MCP stays intact.
- Anonymous UI `why featured` copy is derived from public tier, importance and
  HKR booleans; raw reasoning is never renamed into a public field.
- Feed/search parity includes SQLite LIKE `%` and `_` wildcard semantics,
  featured including p1, all excluding excluded, canonical lead dedup,
  source-id precedence, inclusive/exclusive date windows, sorting and totals.
- `sources.enabled` is ingestion state, not historical visibility. Do not add a
  new enabled-source visibility filter.
- Canonical state retains all eligible visible items needed for item/event
  details. Feed/RSS derivation alone performs canonical-lead deduplication.
- Relative-time semantics (`today`, still-developing, pulse/topics) use an
  injected `nowMs` in the pure query engine, not a hidden full rebuild.
- Canonical metadata is bounded-shard persisted (items by UTC month, details
  and events by stable ID bucket). A publish reads/rewrites only shards and
  dependency summaries touched by changed entities; it never downloads or
  re-derives the entire canonical corpus on a recurring tick.
- New route files remain thin; public-content core/ports stay framework-free;
  only `lib/public-content/publisher/source.ts` may import `db/*`.
- Default verification must parse both exit status and failure/timeout evidence.
- Publisher telemetry retains the frozen `scannedRows` field. Because libSQL
  does not expose per-query rows-read, its value is a proven conservative query-
  plan upper bound and carries `scanMeasurementKind: "plan_upper_bound"` plus
  the plan/index receipt; the verifier rejects untyped estimates. Exact Turso
  `rows_read` remains an external from/to-window measurement.
- Parity fixtures are hand-authored and hash-frozen before implementation from
  current public contracts. Every important semantic also has an independent
  known-wrong mutation. Do not regenerate a golden to make new code pass.
- Each cloud integration run must first be recorded in `loop/STATE.md` and stay
  within 500 object writes, 10,000 requests, 1 GiB and the named Turso window.
- Preserve existing user changes. Do not push.

## Task 1: Build the hermetic command primitive

**Acceptance:** AC-001 foundation.

**Files:**

- Create: `bunfig.toml`
- Create: `scripts/verification/environment-policy.ts`
- Create: `scripts/verification/run-checked-command.ts`
- Create: `tests/verification/environment-policy.test.ts`
- Create: `tests/verification/run-checked-command.test.ts`
- Create: `tests/fixtures/verification/exit-zero-failure.ts`
- Create: `tests/fixtures/verification/hang.ts`

**Steps:**

1. Write failing tests proving Bun dotenv is disabled, inherited Turso/R2/
   Cloudflare/AWS production keys are removed from child environments, only
   local `file:` DB and fake-object-store test values are permitted, and secret
   values are never rendered in diagnostics.
2. Write failing tests proving exit 0 plus Bun `(fail)`/timeout output, a missing
   completion sentinel, a real nonzero exit, and a controller deadline all
   return nonzero from the checked-command primitive.
3. Run RED:
   `bun --no-env-file test tests/verification/environment-policy.test.ts tests/verification/run-checked-command.test.ts`.
4. Add root `bunfig.toml` with `env = false`; implement typed environment
   allow/deny policy and checked child execution with bounded termination.
5. Run GREEN with the same command; verify `git diff --check`.
6. Commit: `test: add hermetic command firewall`.

## Task 2: Make default test and verify paths hermetic

**Acceptance:** AC-001.

**Files:**

- Create: `scripts/verification/run-hermetic-tests.ts`
- Create: `scripts/verification/run-hermetic-verify.ts`
- Create: `scripts/verification/r2-public.ts`
- Create: `scripts/verification/r2-public-criteria.ts`
- Create: `tests/verification/hermetic-entrypoints.test.ts`
- Create: `tests/integration/production/README.md`
- Move/guard explicitly: `tests/api/public-feed.test.ts`
- Move/guard explicitly: `tests/api/public-search.test.ts`
- Move/guard explicitly: `tests/api/v1.test.ts`
- Modify: `package.json`
- Modify: `docs/testing/strategy.md`
- Modify: `docs/HANDOFF.md`

**Steps:**

1. Write RED tests for `bun run test`, `bun run verify`, production-integration
   opt-in, Next build poison/local environment, and the AC-001 criterion command.
2. Inventory every test that gates on `TURSO_DATABASE_URL`; record it in the
   production-integration README. Reclassify the three unconditional real-DB
   suites as explicit `.integration.ts` inputs without adding skip/xfail.
3. Implement `test` as the hermetic runner and retain real production tests only
   behind `RUN_PRODUCTION_INTEGRATION=1` plus a separate explicit script.
4. Implement a hermetic verify wrapper that runs typecheck, lint, build, dead
   code checks and tests under safe child environments; Next receives explicit
   local/poison values so it cannot overwrite them from `.env.local`.
5. Implement `verify:r2-public --criterion AC-001` with known-red sentinel,
   local libSQL/fake-R2 fixture, and exit-zero timeout/failure self-test receipts.
6. Run RED then GREEN:
   `bun --no-env-file test tests/verification/hermetic-entrypoints.test.ts` and
   `bun run verify:r2-public --criterion AC-001`.
7. Only after the criterion passes, run `bun run test` once and confirm output is
   pristine. Do not run production integration.
8. Update `loop/ACCEPTANCE.md` to `PASS_PENDING_FINAL`, state/evidence, then
   commit: `test: make default verification hermetic`.

## Task 3: Close saved-data privacy and calendar prefetch amplification

**Acceptance:** AC-007 partial, P0.

**Files:**

- Create: `lib/auth/session-identity.ts`
- Modify: `lib/auth/session.ts`
- Modify: `proxy.ts`
- Modify: `app/[locale]/saved/page.tsx`
- Modify: `app/api/saved/export/route.ts`
- Modify: `app/sitemap.ts`
- Modify: `app/robots.ts`
- Modify: `components/feed/calendar-grid.tsx`
- Modify: `tests/api/session-routes-source.test.ts`
- Create: `tests/privacy/saved-boundary.test.ts`
- Create: `tests/feed/calendar-prefetch.test.tsx`

**Steps:**

1. Reverse the current source test that blesses `ADMIN_USER_ID`; add RED behavior
   tests proving anonymous saved page redirects before any DB loader and export
   returns 401 without executing its body.
2. Add RED discovery tests proving sitemap excludes saved and robots disallows
   `/saved`, `/zh/saved`, `/en/saved`.
3. Add RED component/source test requiring `prefetch={false}` on every calendar
   date Link.
4. Extract cookie-only identity parsing so the optimistic Proxy check does not
   import DB. Keep the hard page/route auth check because Proxy is not authz.
5. Remove every admin fallback, update discovery, disable calendar prefetch.
6. Run focused GREEN tests and `bun run typecheck`.
7. Commit: `fix: protect saved data and disable calendar prefetch`.

## Task 4: Generate and test the anonymous entrypoint inventory

**Acceptance:** AC-009 foundation.

**Files:**

- Create: `lib/public-content/entrypoints.ts`
- Create: `scripts/verification/discover-public-entrypoints.ts`
- Create: `scripts/ops/check-public-db-boundary.ts`
- Create: `tests/tooling/public-entrypoints.test.ts`
- Create: `tests/tooling/public-db-boundary.test.ts`
- Create: `docs/reports/r2-public-read/source-boundary-known-red-2026-07-14.md`

**Steps:**

1. Write RED discovery tests against App Router source and
   `.next/server/app-paths-manifest.json`: every page/GET is classified, GET
   implies HEAD, page implies HTML/RSC, and an unclassified synthetic entry fails.
2. Include all approved snapshot-only pages, public APIs, UI follow-ups and RSS;
   separately classify static public and private/authenticated entries.
3. Write recursive TypeScript import-graph tests that reject `db/**`,
   `@libsql/client`, `drizzle-orm`, publisher modules, DB-owning loaders and
   Turso secret names. Ignore type-only edges only when the target is pure.
4. Prove the guard fails on a synthetic transitive bad import, then passes on a
   pure fixture graph.
5. Run the guard once against current source/build and record the expected-red
   23/23 libSQL bundle baseline without wiring that known-red state into the
   default green suite.
6. Commit: `test: define anonymous serving boundary`.

## Task 5: Define strict snapshot contracts and canonical bytes

**Acceptance:** AC-002 foundation.

**Files:**

- Create: `lib/public-content/contracts.ts`
- Create: `lib/public-content/canonical.ts`
- Create: `lib/public-content/eligibility.ts`
- Create: `lib/public-content/paths.ts`
- Create: `lib/public-content/public-rubric.ts`
- Create: `tests/public-content/contracts.test.ts`
- Create: `tests/public-content/canonical.test.ts`
- Create: `tests/public-content/eligibility.test.ts`

**Steps:**

1. RED strict-Zod tests for schema v1 pointer, manifest, artifact descriptor,
   item/event/source/newsletter/policy records, canonical state and run receipt.
2. RED forbidden-field sentinels for reasoning variants, HKR explanations, raw
   body/RSS, embeddings, claims/errors, source notes/errors, AI HOT raw payload,
   users/feedback/saved/tweaks/tokens/usage/iteration output.
3. RED eligibility tests: unenriched/excluded/no-content lead fails closed;
   visible event members remain available for detail; disabled source history is
   not silently removed.
4. RED canonical serialization tests: recursive object-key sort, business array
   order preserved, stable entity-ID order, UTF-8 plus one trailing newline,
   SHA-256 stability, and rejection of undefined/BigInt/NaN/Infinity.
5. Implement focused contracts and pure rubric-derived `whyFeatured` copy.
6. Run focused tests, typecheck and `git diff --check`.
7. Commit: `feat: define public snapshot contracts`.

## Task 6: Build the pure public query and derivation engine

**Acceptance:** AC-002 and AC-006 foundations.

**Files:**

- Create: `lib/public-content/query.ts`
- Create: `lib/public-content/derive.ts`
- Create: `lib/public-content/public-items.ts`
- Create: `lib/public-content/public-dailies.ts`
- Create: `lib/public-content/rss.ts`
- Modify/extract pure portions: `lib/rss/render.ts`
- Create: `tests/public-content/query.test.ts`
- Create: `tests/public-content/derive-parity.test.ts`
- Create: `tests/public-content/rss.test.ts`

**Steps:**

1. Hand-author and hash-freeze current public serializer/feed/RSS fixtures from
   the pre-change source and documented API contracts. Add independent known-
   wrong mutants for wildcard, tier, lead dedup, source precedence, date bounds
   and eligibility; never source expected bytes from the new implementation.
2. RED feed/query cases for both locales, tier semantics, lead dedup, source-id
   precedence, source group/kind/tags, date/range/today, SQLite LIKE `%`/`_`,
   fixed-clock sorting, offset/limit/total and item/event eligibility.
3. RED shell/calendar/podcast/x/source/daily derivation cases with injected
   `nowMs`; ensure time passage does not require a corpus rebuild.
4. RED exact XML byte/header fixture cases for main/newsletter/legacy feeds.
5. Implement normalized-state pure queries and artifact derivation. Do not
   import Next, DB, process env, filesystem or network.
6. Run focused tests and typecheck.
7. Run the AC-002 criterion verifier; update AC-002 to `PASS_PENDING_FINAL` only
   after strict contracts, forbidden sentinels and frozen parity fixtures pass.
8. Commit: `feat: add pure public snapshot queries`.

## Task 7: Implement the snapshot HTTP reader and last-good recovery

**Acceptance:** AC-005.

**Files:**

- Create: `lib/public-content/reader/types.ts`
- Create: `lib/public-content/reader/fetch-object.ts`
- Create: `lib/public-content/reader/read-release.ts`
- Create: `lib/public-content/reader/index.ts`
- Create: `lib/public-content/testing/memory-store.ts`
- Create: `tests/public-content/reader.test.ts`

**Steps:**

1. RED tests for current success, pointer/manifest/object schema and hash checks,
   current corruption to previous, warm last-known-good, both invalid to typed
   controlled-unavailable, timeout and unknown schema.
2. Place a poison DB spy beside every branch; assert it is never touched.
3. Implement one injected `fetch`, clock and timeout boundary. Fetch only the
   public custom domain; never import writer credentials or S3 client.
4. Make cache keys release/content addressed. Do not let a request parameter
   choose an arbitrary R2 key.
5. Map terminal reader failure to a typed error; route adapters will emit 503.
6. Run focused tests, source-boundary fixture guard and typecheck.
7. Keep AC-005 OPEN until its AC-003 dependency passes; record local reader
   evidence and commit: `feat: add fail-closed public snapshot reader`.

## Task 8: Add checksummed outbox migration and narrow triggers

**Acceptance:** AC-003 foundation.

**Files:**

- Modify: `db/schema.ts`
- Create: `lib/public-content/publisher/outbox-migration.ts`
- Create: `scripts/ops/migrate-public-content-outbox.ts`
- Create: `tests/public-content/outbox-migration.test.ts`

**Steps:**

1. RED local file-libSQL tests for creating checksummed `schema_migrations`,
   `public_content_outbox`, its range/entity index and all triggers.
2. Prove migration rerun is a no-op and same-name/different-checksum fails loud.
3. For items/clusters/sources/source_health/newsletters/policy_versions, test
   relevant insert/update/delete events, same-value UPDATE no-op, private-only
   update no-op, item cluster OLD+NEW enqueue and tombstones.
4. Test captured high-water deletion leaves all `id > highWater` rows.
5. Assert EXPLAIN uses outbox PK range, item PK and `items_cluster_idx` plans.
6. Implement additive raw SQL only; never invoke Drizzle push.
7. Run local migration tests and typecheck. Do not apply to production.
8. Commit: `feat: add public content outbox migration`.

## Task 9: Implement the bounded publisher source adapter

**Acceptance:** AC-003 bounded-read proof.

**Files:**

- Create: `lib/public-content/publisher/types.ts`
- Create: `lib/public-content/publisher/source.ts`
- Create: `lib/public-content/publisher/patch-state.ts`
- Create: `tests/public-content/publisher-source.test.ts`

**Steps:**

1. Define the injected source port, hard dependent-row caps and telemetry fields:
   candidate rows, deduped entities, returned rows, `scannedRows`,
   `scanMeasurementKind: "plan_upper_bound"`, query count and verified
   plan/index names. `scannedRows` is the conservative bound proved by the
   recorded plan, never an untyped estimate or a claim of driver-provided data.
2. RED local DB tests: no-change reads only pointer watermark/outbox; changed
   keys dedupe; missing rows make tombstones; eligibility transitions remove or
   add entities; cluster members use one batched query; cap overflow aborts.
3. RED query-plan and query-count tests that make per-event N+1 impossible.
4. Implement the sole public-content DB adapter in `publisher/source.ts`; core
   patch logic receives validated rows and remains pure.
5. Run focused tests and recursive boundary tests.
6. Commit: `feat: add bounded snapshot publisher source`.

## Task 10: Implement pointer-last publisher core and R2 writer

**Acceptance:** AC-003 atomicity/idempotency.

**Files:**

- Modify: `package.json`
- Modify: `bun.lock`
- Create: `lib/public-content/publisher/object-store.ts`
- Create: `lib/public-content/publisher/r2-store.ts`
- Create: `lib/public-content/publisher/build-release.ts`
- Create: `lib/public-content/publisher/publish.ts`
- Create: `tests/public-content/publisher.test.ts`
- Create: `tests/public-content/r2-store.test.ts`

**Steps:**

1. Add pinned `@aws-sdk/client-s3` with a frozen-lock install and inspect the
   installed API before use.
2. RED event-log fake tests for object PUT/readback failure, hash/schema failure,
   manifest failure, pointer CAS loss, ambiguous CAS, ack failure and retry.
3. Assert content objects are uploaded/validated before manifest, manifest
   before pointer, and pointer is the only commit write.
4. Assert unchanged hash reuse, deterministic retry release ID/bytes, CAS loser
   never acks, `id > highWater` survives, and committed-with-pending-ack retries
   clean without publishing a duplicate.
5. Add a scale test over a fixed large prior release: 1 versus 100 changed
   entities may touch only proportional bounded shards/dependency summaries;
   no-change touches no content shard, and corpus size alone cannot increase
   recurring object reads/writes or derivation work.
6. Implement the port-first core, then the validated R2 S3 adapter with
   region `auto`, path helpers and conditional writes. Never expose credentials
   to reader/public modules.
7. Run focused fake tests only; no R2 integration.
8. Commit: `feat: publish atomic R2 snapshot releases`.

## Task 11: Wire publisher cron, bootstrap, reconciliation and retention

**Acceptance:** AC-003 operational surface.

**Files:**

- Create: `app/api/cron/publish-public/route.ts`
- Create: `scripts/ops/publish-public-snapshot.ts`
- Create: `scripts/ops/bootstrap-public-snapshot.ts`
- Create: `scripts/ops/reconcile-public-snapshot.ts`
- Create: `lib/public-content/publisher/retention.ts`
- Modify: `scripts/ops/run-cron.ts`
- Modify: `vercel.json`
- Modify: `package.json`
- Create: `tests/cron/public-snapshot-publisher.test.ts`
- Create: `tests/public-content/bootstrap-retention.test.ts`

**Steps:**

1. RED source tests for authenticated cron route, operator parity and exact
   `12,27,42,57 * * * *` schedule.
2. RED proof that recurring publish cannot call bootstrap/full materialize.
3. RED bounded daily reconcile and pure weekly retention planner tests; preserve
   at least seven releases and 30 days, and require an operator pause for pointer
   rollback/repair.
4. Wire injected services and structured ops receipts. Bootstrap requires an
   explicit flag, spend-ledger precondition and refuses a second execution.
5. Run focused tests. Do not run any script against production.
6. Update AC-003 to `PASS_PENDING_FINAL`, re-run AC-005 against the real release
   contract, then update AC-005 to `PASS_PENDING_FINAL`; commit:
   `feat: wire incremental snapshot publishing`.

## Task 12: Migrate low-complexity public JSON and UI follow-ups

**Acceptance:** AC-006 partial.

**Files:**

- Create: `lib/public-content/http.ts`
- Modify: `app/api/public/sources/route.ts`
- Modify: `app/api/public/items/[id]/route.ts`
- Modify: `app/api/public/events/[id]/members/route.ts`
- Modify: `app/api/public/daily/route.ts`
- Modify: `app/api/public/daily/[date]/route.ts`
- Modify: `app/api/public/dailies/route.ts`
- Modify: `app/api/events/[id]/members/route.ts`
- Modify: `app/api/sources/active/route.ts`
- Create: `tests/api/public-snapshot-routes.test.ts`

**Steps:**

1. RED golden tests for response body, localization, ETag/304, CORS, implicit
   HEAD, 400/404 and reader-unavailable 503, with a poison DB sentinel.
2. Include excluded/unenriched guessed item IDs and require 404.
3. Implement thin adapters over reader/query results; split any parser/type that
   currently lives in a DB-owning module into the pure boundary.
4. Remove transitive DB imports from these route entrypoints.
5. Run route tests, inventory coverage and focused recursive guard.
6. Commit: `feat: serve public metadata APIs from snapshots`.

## Task 13: Migrate public feed and lexical search

**Acceptance:** AC-006 partial and AC-008.

**Files:**

- Modify: `app/api/public/feed/route.ts`
- Modify: `app/api/public/search/route.ts`
- Modify/extract: `lib/api/feed-query-params.ts`
- Modify: `app/openapi.yaml/route.ts` or its source artifact
- Modify: `app/skill.md/route.ts` or its source artifact
- Modify: `docs/agent-access/README.md`
- Create: `tests/api/public-snapshot-feed-search.test.ts`

**Steps:**

1. RED parity matrix for both locales, every filter/tier/view/date/range,
   wildcard LIKE, pagination/total/sort and ETag/304.
2. RED semantic request expecting exact HTTP 422/error body while embedding,
   semantic search and DB sentinels stay untouched.
3. Keep v1/MCP semantic tests unchanged and green.
4. Migrate public adapters to snapshot query only; keep pure shared parsers free
   of static DB imports.
5. Update OpenAPI/skill/agent docs in the same task and contract-test them.
6. Run focused tests, typecheck and recursive guard.
7. Update AC-008 to `PASS_PENDING_FINAL`; commit:
   `feat: move public feed search to snapshots`.

## Task 14: Migrate all public RSS variants

**Acceptance:** AC-006 partial.

**Files:**

- Modify: `app/api/feed/[locale]/rss.xml/route.ts`
- Modify: `app/api/feed/newsletter/[locale]/rss.xml/route.ts`
- Modify: `app/api/rss/[slug]/route.ts`
- Modify/extract: `lib/rss/main-feed.ts`
- Modify/extract: `lib/rss/newsletter-feed.ts`
- Modify/extract: `lib/rss/legacy-feeds.ts`
- Create: `tests/rss/snapshot-routes.test.ts`

**Steps:**

1. RED exact-byte and header parity for zh/en main, zh/en newsletter and
   today/curated/daily legacy slugs; include invalid slug and implicit HEAD.
2. Make routes read publisher-rendered immutable XML bytes from the release.
3. Preserve content type/cache behavior and rate-limit contract, but remove all
   DB-owning imports and request-time rendering queries.
4. Run focused tests and recursive guard.
5. Update AC-006 to `PASS_PENDING_FINAL` once Tasks 12-14 are green; commit:
   `feat: serve RSS from immutable snapshots`.

## Task 15: Migrate anonymous HTML, RSC and shell follow-up reads

**Acceptance:** AC-007.

**Files:**

- Modify: `app/[locale]/page.tsx`
- Modify: `app/[locale]/all/page.tsx`
- Modify: `app/[locale]/curated/page.tsx`
- Modify: `app/[locale]/sources/page.tsx`
- Modify: `app/[locale]/podcasts/page.tsx`
- Modify: `app/[locale]/podcasts/[id]/page.tsx`
- Modify: `app/[locale]/x-monitor/page.tsx`
- Modify: `app/[locale]/daily/page.tsx`
- Modify: `app/[locale]/daily/[date]/page.tsx`
- Modify: `app/[locale]/agents/page.tsx`
- Modify: `lib/shell/chrome-data.ts`
- Modify: `components/shell/source-picker.tsx`
- Create: `tests/e2e/public-snapshot-pages.test.ts`
- Create: `tests/feed/public-rubric.test.ts`

**Steps:**

1. RED server/browser corpus with fixture release and poison DB: all page/query
   variants render, RSC requests work, SourcePicker follows the snapshot alias,
   and snapshot-unavailable returns the planned controlled error boundary.
2. RED browser network assertion: opening `/all` produces no date-prefetch RSC
   fan-out before intent.
3. RED visibility cases: excluded/unenriched items never render; public rubric
   copy renders without any reasoning field in server/client payload.
4. Replace every page/shell DB loader with reader/query calls. Query variants may
   stay dynamic; static canonical routes may use ISR only as an extra cache.
5. Ensure `searchParams` does not reintroduce a DB path; follow Next 16 caching
   behavior from the installed docs.
6. Run focused browser/server tests, typecheck and recursive guard.
7. Update AC-007 to `PASS_PENDING_FINAL`; commit:
   `feat: render anonymous pages from snapshots`.

## Task 16: Enforce clean source/NFT builds and poison-Turso runtime

**Acceptance:** AC-009 and AC-010.

**Files:**

- Extend: `scripts/ops/check-public-db-boundary.ts`
- Create: `scripts/verification/check-public-nft.ts`
- Create: `scripts/verification/serve-snapshot-fixture.ts`
- Create: `tests/tooling/public-nft-boundary.test.ts`
- Create: `tests/e2e/public-poison-turso.test.ts`
- Modify: `package.json`

**Steps:**

1. RED synthetic source mutation and synthetic NFT each fail their guard.
2. Build with Turso absent/poisoned and local snapshot HTTP fixture. Discover
   authoritative bundles from `app-paths-manifest.json`; reject libSQL/native DB,
   Drizzle, publisher, Turso names and unclassified entries.
3. Start a local recording poison endpoint. Exercise every inventoried GET,
   implicit HEAD, HTML, RSC, API and RSS route against a cold runtime; require
   expected status/schema/release and exactly zero poison connections.
4. Make the clean production build and full corpus pass without weakening the
   known-bad mutations.
5. Wire source/NFT/poison gates into `verify:r2-public`.
6. Update AC-009 and AC-010 to `PASS_PENDING_FINAL`; commit:
   `test: enforce zero DB public serving bundles`.

## Task 17: Add bounded load, cache, rollout and final evidence tooling

**Acceptance:** AC-004, AC-011 and AC-012 harnesses; production execution gated.

**Files:**

- Create: `scripts/ops/load-anonymous.ts`
- Create: `scripts/ops/verify-r2-cache.ts`
- Create: `scripts/ops/measure-turso-window.ts`
- Create: `scripts/ops/verify-public-cutover.ts`
- Create: `tests/ops/public-load-budget.test.ts`
- Create: `tests/ops/r2-cache-contract.test.ts`
- Extend: `scripts/verification/r2-public.ts`
- Modify: `loop/VERIFY.md`

**Steps:**

1. RED local tests for spend-ledger precondition and hard caps: 500 writes,
   10,000 requests, 1 GiB, one bootstrap and named exact Turso windows.
2. Implement deterministic 1x/10x/100x session corpora from the generated
   inventory, including cold reader/cache and missing-object cases.
3. Implement sanitized receipt parsers for real R2 pointer/immutable MISS-HIT,
   CORS/TLS/ETag/TTL/Age and exact Turso from/to windows with equal controls.
4. Final verifier must require receipts rather than infer from mocks or CDN HIT.
5. Run only local fixture tests. Do not publish/deploy/load production.
6. Commit: `test: add public decoupling evidence harness`.

## Task 18: Synchronize architecture and operator runbooks

**Acceptance:** AC-013 local portion.

**Files:**

- Modify: `docs/README.md`
- Modify: `docs/architecture/overview.md`
- Modify: `docs/architecture/ingestion.md`
- Modify: `docs/agent-access/README.md`
- Modify: `docs/testing/strategy.md`
- Modify: `docs/HANDOFF.md`
- Modify: `.env.example`
- Create: `docs/operations/public-snapshots.md`
- Create: `tests/docs/public-snapshot-docs.test.ts`

**Steps:**

1. RED contract/link tests against runtime inventory, scripts, env names, search
   envelope, cadence, rollback and credential boundaries.
2. Document public reader/publisher/private ownership, safe tests, cache rule,
   shadow/bootstrap/cutover, pointer/application rollback, retention, monitoring,
   token revocation and the still-pending production evidence gate.
3. Remove obsolete production-backed default test guidance and stale DB-cache
   ownership claims.
4. Run docs tests, link checks and `bun run verify:r2-public` local channels.
5. Keep AC-013 OPEN until AC-004/AC-012 production evidence and the final
   measured budget are written. Run `neat-freak`, then an independent
   whole-branch spec/code/security review;
   fix every in-scope finding and re-run affected tests.
6. Record the local documentation evidence without changing AC-013 status;
   commit:
   `docs: document R2 public serving ownership`.

## External production gate and closure

After Tasks 1-18 and the independent branch review are green, stop before any
external mutation and request the already-frozen authorization for:

1. apply checksummed outbox migration;
2. run the one separately metered bootstrap and real-release cache probe;
3. deploy producer-only/shadow, compare production samples, then canary/cut over
   route-by-route with no public dual-read;
4. run rollback drills, cold/warm/failure and 1x/10x/100x controlled replays;
5. observe a 48-hour stable period and at least one exact clean 24-hour Turso
   window;
6. prove `<136,986 rows/hour`, publisher `<5M/month`, and either
   `<13,699 rows/hour` or attach measured non-public residual attribution;
7. remove the temporary public DB rollout mode and obsolete request caches;
8. update the current architecture/handoff/operator docs with the measured
   budget, shipped ownership and rollback results, then pass AC-013;
9. run `bun run verify:r2-public --final` in the same repo/deployment state.

Only the final verifier may turn `PASS_PENDING_FINAL` into `PASS` and complete
the goal.
