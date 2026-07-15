# AC-001 Hermetic Gate Receipt — 2026-07-14

Goal version: `r2-public-read-v1-ec57c55fe111`

Status: `PASS_PENDING_FINAL`. This is local criterion evidence; the terminal
`bun run verify:r2-public --final` remains authoritative for final PASS.

## RED

Before rewiring, the focused entrypoint test rejected `package.json` because
`test` was `bun test --env-file=.env.local`. The expanded RED also failed on
missing hermetic runners and missing safe auth-token shadows.

The first newly-safe full default run exposed two additional legacy assumptions
without touching production: `workers/newsletter/select.test.ts` queried an
empty local SQLite file, and a tooling source contract expected the old verify
string. The newsletter selector now accepts a pure candidate loader for local
fixtures; its production default remains the same DB loader.

## GREEN

- `bun --no-env-file test tests/verification/environment-policy.test.ts tests/verification/hermetic-entrypoints.test.ts`
  — focused environment/entrypoint suite passed; the final criterion rerun
  included 9 entrypoint tests and 104 assertions.
- `bun run verify:r2-public --criterion AC-001` — exit 0 with receipts for:
  inherited production credential stripping; unsafe remote override rejection;
  file-backed libSQL; in-memory fake R2; 11 explicit production integrations;
  hostile inherited Turso/R2 values; exit-zero `(fail)` rejection; exit-zero
  timeout-text rejection; and controller deadline termination.
- `bun run verify` — typecheck, zero-warning lint, Next production build, all
  three Knip gates, and 1,198 tests passed; 0 failed with 6,008 assertions
  across 168 files.

The Next loader probe creates an adversarial `.env.local`, confirms Next really
loaded that file, and verifies it could not replace any of the 28 explicitly
shadowed Turso/libSQL/R2/AWS/Cloudflare URL, auth, token, account, bucket,
endpoint, or region values.

## Review hardening

An independent reviewer found two fail-loud gaps and both were reproduced RED
before repair. Focused test input is now intersection-checked against the
default discovered regular-file allowlist; production directory ancestry,
`.integration.ts`, `.live.ts`, directories, and arbitrary repo files are all
rejected before spawning Bun. The actual command
`bun run test -- tests/integration/production` exited nonzero with a production-
integration diagnostic.

Every bare `return;` in production integration setup/test paths was replaced by
an explicit named precondition error. The source contract scans all 11 standard
inputs plus the live semantic input and forbids skip/xfail and bare-return false
greens. Cleanup remains safe without silently satisfying named assertions.

## Production boundary

All 11 real-Turso suites are fail-loud explicit inputs under
`tests/integration/production/`; none uses skip/xfail. The separate production
command requires `RUN_PRODUCTION_INTEGRATION=1`. The live Azure semantic smoke
has its own additional switch and command. Neither production command was run.

No production DB/R2/Cloudflare request, deploy, publish, push, or external
mutation occurred. This criterion proves production credential/test isolation;
it does not claim the build is offline, because Next font behavior and `bunx`
package tooling may still use normal network paths.
