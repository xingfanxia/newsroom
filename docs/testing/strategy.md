# Testing And Local Verification Strategy

This is the current testing and verification runbook. Historical plans may
mention older commands; use this file plus `package.json` scripts as the
source of truth.

## Default Gate

Run the full local gate before committing a code or docs change:

```bash
bun run verify
```

`verify` runs, in order:

1. `bun run typecheck` — standalone `tsc --noEmit`, including tests and Bun runtime APIs.
2. `bun run lint` — ESLint with zero warnings expected.
3. `bun run build` — Next production build and route/type generation.
4. `bun run code:dead`, `bun run code:dead:exports`, and `bun run code:dead:types` — Knip file/dependency/export gates.
5. `bun run test` — full Bun test suite with `.env.local`.

Also run `git diff --check` before committing so whitespace issues are caught
outside the package script. It is not part of `verify` because agents usually
run `verify` while there are intentional unstaged edits.

## Targeted Tests

Use targeted tests while iterating, then finish with `bun run verify`.

```bash
bun test --env-file=.env.local path/to/test.ts
```

For source-contract changes, prefer the existing `tests/**/**-source.test.ts`
pattern. These tests intentionally read runtime files and docs to prevent
duplicate enum lists, stale routing guidance, or helper drift from returning.

For real-DB tests, keep the `POSTGRES_URL` / `DATABASE_URL` skip behavior in
the test itself. Do not replace DB-backed invariants with source-only checks
unless the behavior is impossible to exercise locally.

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
