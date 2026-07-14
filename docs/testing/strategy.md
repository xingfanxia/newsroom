# Testing And Local Verification Strategy

This is the current testing and verification runbook. Historical plans may
mention older commands; use this file plus `package.json` scripts as the
source of truth.

## Default Gate

Run the full local gate before committing a code or docs change:

```bash
bun run verify
```

`verify` runs every stage through the checked hermetic command wrapper, in
order:

1. `bun run typecheck` — standalone `tsc --noEmit`, including tests and Bun runtime APIs.
2. `bun run lint` — ESLint with zero warnings expected.
3. `bun run build` — Next production build and route/type generation.
4. `bun run code:dead`, `bun run code:dead:exports`, and `bun run code:dead:types` — Knip file/dependency/export gates.
5. `bun run test` — the explicitly enumerated hermetic Bun test suite.

The wrapper disables Bun dotenv discovery, removes inherited Turso/R2/AWS/
Cloudflare credentials, and supplies explicit file-backed libSQL plus `fake-*`
object-store/control-plane values. Next's own env loader receives those values
before it reads `.env.production.local` or `.env.local`, so dotenv cannot fill
in a missing production auth token. Each stage must both exit zero and emit its
private completion sentinel; visible `(fail)`, timeout, or between-test
unhandled-error output rejects the gate even when Bun exits zero.

Hermetic here means production Turso/R2 credentials and integration tests are
unreachable from the default gate. It does not promise an offline build: Next
font resolution and `bunx knip` may still use their normal package/network
behavior.

Also run `git diff --check` before committing so whitespace issues are caught
outside the package script. It is not part of `verify` because agents usually
run `verify` while there are intentional unstaged edits.

## Targeted Tests

Use targeted tests while iterating, then finish with `bun run verify`.

```bash
bun run test -- path/to/test.ts
```

Focused inputs must be regular files in the default discovered test allowlist.
Directories, arbitrary source files, and production `.integration.ts`/`.live.ts`
inputs are rejected before the Bun test child starts.

For source-contract changes, prefer the existing `tests/**/**-source.test.ts`
pattern. These tests intentionally read runtime files and docs to prevent
duplicate enum lists, stale routing guidance, or helper drift from returning.

Real-production DB tests live under `tests/integration/production/` with an
`.integration.ts` or `.live.ts` suffix and are absent from default discovery.
They fail loud unless the dedicated command and explicit switch are both used;
there are no skip/xfail fallbacks:

```bash
RUN_PRODUCTION_INTEGRATION=1 bun run test:production
```

The optional Azure semantic smoke additionally requires
`RUN_LIVE_SEMANTIC_TEST=1` and `bun run test:production:semantic`. See
`tests/integration/production/README.md` for the complete input and mutation
inventory. Never run either command during a clean Turso measurement window.

## Mocking — bun `mock.module` is process-global

`bun`'s `mock.module` replaces a module for the **whole test process**, not just the
current file, and there is no reliable per-file restore. A leaked or wholesale-replace
stub poisons every later suite. Three rules the read-budget cache tests (W9c-1/2/3)
each had to re-learn:

1. **Never globally mock `@/db/client`.** A bare `db()` stub returns fakes for every
   `(real DB)` test that runs afterward, reddening them. Stub the smallest layer above
   the DB instead — mock the query/render fn one level down, or split a cached wrapper
   into its own module (as `lib/rss/legacy-feeds-cache.ts` did) so the test stubs the
   pure inner fn via that module's import boundary.
2. **Spread-mock, never replace wholesale:** `mock.module("@/x", () => ({ ...actual, foo }))`.
   A bare `() => ({ foo })` drops `@/x`'s other exports and breaks unrelated suites at
   import time (`Export named 'Y' not found` — the W9c-1 CRITICAL). Make `next/cache`
   stubs shape-complete (`unstable_cache` **and** `revalidateTag`).
3. **Construct `unstable_cache` wrappers at CALL time** inside the query fn, not at
   module scope. Module-scope wrappers are built when the module is first imported —
   before a later test's `mock.module` can register — so they capture the real
   `unstable_cache` and are untestable. Call-time construction is prod-identical (the
   Data Cache key is `cb.toString()+keyParts+JSON.stringify(args)`, independent of
   wrapper identity) and re-mockable (as `runFeedQuery`/`runSearchQuery` and
   `feed-cache.ts`'s arg-taking readers do).

A targeted single-file run **masks** all three — always cross-check with the full
`bun run test` before declaring a mock-touching change clean. Do not bypass the
runner with a raw `bun test tests/` command.

## Docs Changes

When changing architecture, public routes, cron behavior, LLM provider routing,
agent/API contracts, or data ownership:

1. Update runtime code and focused tests.
2. Update the current source doc from `docs/README.md`.
3. Add or update a source-contract test when the change creates a new routing
   rule, enum source of truth, or verification command.
4. If an older plan or handoff now contradicts current behavior, add an archive
   banner or route readers to the current doc instead of editing history as if
   it were the present.
