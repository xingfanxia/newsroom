# Production Integration Tests

These tests read or mutate the real Turso database and are deliberately absent
from default Bun discovery (`*.integration.ts`, not `*.test.ts`). The default
`bun run test` command enumerates only hermetic test/spec files and rejects any
production-integration input passed to it.

## Explicit invocation

Production integration requires both the dedicated command and an explicit
switch. Bun dotenv loading is disabled globally, so credentials must already be
present in the invoking shell; this command never loads `.env.local` itself.

```bash
RUN_PRODUCTION_INTEGRATION=1 bun run test:production
```

This suite can write temporary users, feedback, collections, policy versions,
and API tokens. It is never part of `bun run test`, `bun run verify`, or
`verify:r2-public --criterion AC-001`. Do not run it during a clean Turso
measurement window. The live semantic provider smoke is a separate command and
requires both switches:

```bash
RUN_PRODUCTION_INTEGRATION=1 RUN_LIVE_SEMANTIC_TEST=1 \
  bun run test:production:semantic
```

Running an individual `*.integration.ts` file still calls
`assertProductionIntegrationOptIn()` and fails before a database operation when
the switch or `TURSO_DATABASE_URL` is absent. There are no skip/xfail fallbacks;
an attempted production run either executes its assertions or fails loud.
Data prerequisites (for example, enough feed/search rows or an existing item)
are explicit failing preconditions, never silent test-body returns. A source
contract enforces that production inputs contain no bare `return;` escape hatch.

The default focused-test command accepts only regular files already present in
the generated default discovery allowlist. Direct production files, `.live.ts`
inputs, production directories, arbitrary repo files, and other directories are
rejected before Bun is spawned.

## Inventory

| Previous default-discovery path | Explicit integration input | Behavior |
| --- | --- | --- |
| `tests/api/public-feed.test.ts` | `tests/integration/production/api/public-feed.integration.ts` | Public feed reads |
| `tests/api/public-search.test.ts` | `tests/integration/production/api/public-search.integration.ts` | Public lexical reads |
| `tests/api/v1.test.ts` | `tests/integration/production/api/v1.integration.ts` | API-token writes and v1 reads; optional live semantic provider call |
| `tests/api/collections.test.ts` | `tests/integration/production/api/collections.integration.ts` | Collection/user/feedback writes |
| `tests/api/policy-commit.test.ts` | `tests/integration/production/api/policy-commit.integration.ts` | Policy-version writes |
| `tests/api/saved-routes.test.ts` | `tests/integration/production/api/saved-routes.integration.ts` | User/save/collection writes |
| `tests/api/tweak-routes.test.ts` | `tests/integration/production/api/tweak-routes.integration.ts` | User/tweak writes |
| `tests/auth/feedback-schema.test.ts` | `tests/integration/production/auth/feedback-schema.integration.ts` | User/feedback schema writes |
| `tests/feedback/metrics.test.ts` | `tests/integration/production/feedback/metrics.integration.ts` | User/feedback writes and metric reads |
| `tests/feedback/toggle.test.ts` | `tests/integration/production/feedback/toggle.integration.ts` | User/feedback toggle writes |
| `tests/items/collections.test.ts` | `tests/integration/production/items/collections.integration.ts` | Collection/save ownership writes |

The optional semantic case formerly embedded as a skipped test in
`tests/api/v1.test.ts` is now the fail-loud explicit input
`tests/integration/production/api/v1-semantic.live.ts`; neither production
command reports it as skipped.

The first three were previously unconditional. The remaining eight gated real
DB describes on bare `TURSO_DATABASE_URL`, which turned a production-backed
`.env.local` into an implicit opt-in and produced misleading skipped greens when
it was absent. All eleven now share the explicit manifest in
`scripts/verification/run-hermetic-tests.ts`.
