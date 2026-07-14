# Public source/bundle boundary baseline — known red

Captured: `2026-07-14T14:26:07Z`

Hardened/decomposed receipt refreshed: `2026-07-14T17:35:43Z`

Base commit: `80424f934231ccb37ca815c978bf9c5fa9ddde3e`

This receipt freezes the pre-migration boundary state. It is expected red and
is not an accepted end state or a test that blesses libSQL contamination.

## Inventory

The exhaustive serving inventory classifies 61 built GET/HEAD-capable app
paths:

- 23 snapshot-only migration targets;
- 7 static/framework public entries;
- 20 private authenticated entries;
- 11 operator-authenticated cron entries.

The source scanner covers 60 repository sources. The remaining built entry is
Next's generated `/_global-error/page`. Source and build comparison passed:

```text
$ bun --no-env-file scripts/verification/discover-public-entrypoints.ts
{
  "built": 61,
  "classified": 61,
  "source": 60
}
```

The default unit suite uses a hermetic manifest fixture derived from the frozen
inventory; it does not require an ignored `.next` directory in a pristine
clone. The standalone command above deliberately checks a requested local
build and fails loud when the manifest is absent or malformed.

## Expected-red bundle result

The existing local Task-3 build was inspected without rebuilding and without
network, Cloudflare, R2, Turso, deploy, publish, or production access:

```text
$ bun --no-env-file scripts/ops/check-public-db-boundary.ts --snapshot-only --build --summary
{
  "byRule": {
    "libsql-client": 23
  },
  "contaminatedEntrypoints": 23,
  "label": "build",
  "ok": false,
  "visitedFiles": 25
}
exit 1
```

All 23 snapshot-only migration targets currently include `@libsql/client` in
their Next output trace. This is the exact known-red baseline that later reader
migration tasks must drive to zero.

The hardened recursive source receipt is also intentionally red:

```text
$ bun --no-env-file scripts/ops/check-public-db-boundary.ts --snapshot-only --source --summary
{
  "byRule": {
    "db-owning-loader": 73,
    "db-source": 46,
    "drizzle-orm": 131,
    "libsql-client": 23,
    "turso-secret": 24
  },
  "contaminatedEntrypoints": 23,
  "label": "source",
  "ok": false,
  "visitedFiles": 133
}
exit 1
```

The recursive source check covers all 30 anonymous entries (23 snapshot-only +
7 static/framework public). Of the 29 entries with repository source, the same
23 migration targets currently reach a forbidden DB path; the static entries
are clean. The source guard follows imports/re-exports, literal dynamic imports,
type-only targets, root Proxy, and implicit page convention files. It rejects
unresolved internal or computed edges rather than assuming purity.

The post-review hardening pass also freezes Next 16 dynamic metadata and
interception-route discovery, value-accurate route exports, duplicate raw app
paths, physical symlink containment, exact NFT v1 dependency existence, all
libSQL package families, CommonJS-family `.cts`/`.cjs` modules, and comment-safe
runtime Turso credential detection.

The final review hardening also validates the manifest, compiled module, NFT
trace, and trace-dependency artifacts themselves; preserves specific forbidden
rules for Turbopack package directories; rejects publisher worker bundles; and
fails closed for ambiguous external export-stars or unsupported CommonJS route
mutations instead of using them as POST-only suppression evidence. Static
`module["exports"]` forms are classified, while ambient and type-only
TypeScript bindings cannot hide the runtime CommonJS globals.

The final completeness pass decomposes both scanners into focused modules and
also freezes root/`src` Proxy, deprecated middleware, instrumentation and
instrumentation-client roots; implicit global-not-found and normalized
parallel-slot routes; runtime declaration siblings; indirect CommonJS and
`createRequire` ambiguity; physical symlink/package ownership; runtime namespace,
namespace-declaration, import-equals and export-equals forms; full Edge manifest
ownership; Windows/physical artifact containment; and DB-owning-loader NFT
classification. Selected/global Edge execution remains explicitly
`unverified-edge-content` until Task 16 scans authoritative compiled bytes and
runs the poison-Turso browser/server corpus.

Parallel-route source roots use the same interception-aware request-path helper
as entrypoint discovery. Each named or implicit children branch is evaluated
independently: a normal matching page suppresses that branch's `default`, an
interceptor-only or unmatched branch retains `default` and its wrappers, nested
slots cannot satisfy an outer children branch, and a nested-slot entrypoint
resolves implicit children for every enclosing slot parent. These decisions are
backed by Next 16 production poison/bundle probes and focused regressions.

## Default GREEN fixture gate

```text
$ bun --no-env-file run test -- tests/tooling/public-entrypoints-*.test.ts tests/tooling/public-db-boundary-*.test.ts
101 pass
0 fail
431 assertions

$ bun --no-env-file run typecheck
pass

Structural budgets: 32 production scanner modules are at most 288 lines; every
production function is at most 48 lines; focused test files are at most 366
lines. The decomposed import graph is acyclic.

$ bun --no-env-file run verify:r2-public --criterion AC-001
AC-001_COMPLETE

$ bun --no-env-file run verify
typecheck / lint / Next build / dead-files / dead-exports / dead-types: pass
1309 tests pass
0 fail
6496 assertions
```

Production cutover remains externally gated. No production integration command
was run for this receipt.
