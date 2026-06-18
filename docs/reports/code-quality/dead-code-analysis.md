# Dead Code Analysis

Date: 2026-06-12

Command:

```bash
bun run code:dead
```

Result after the 2026-06-12 cleanup: default dead-code gate exits `0` for
unused files, dependencies, binaries, unlisted dependencies, unresolved imports,
and catalog issues.

The value-export review is intentionally separate:

```bash
bun run code:dead:exports
```

Result after the export-boundary cleanup: exits `0`.

Type-only exports have a separate gate:

```bash
bun run code:dead:types
```

Result after the type-boundary cleanup: exits `0`.

## Interpretation

### Removed In This Pass

- Deleted unused UI/row components:
  - `components/sources/source-row.tsx`
  - `components/ui/badge.tsx`
  - `components/ui/card.tsx`
  - `components/ui/tabs.tsx`
- Deleted the unused Tavily integration file `lib/search/tavily.ts`.
- Removed direct unused dependencies from `package.json` / `bun.lock`:
  `@radix-ui/react-dialog`, `@radix-ui/react-scroll-area`,
  `@radix-ui/react-separator`, `@radix-ui/react-tabs`,
  `@radix-ui/react-tooltip`, `@mozilla/readability`, `date-fns`,
  `tailwindcss`, and `tsx`.
- Kept `@radix-ui/react-slot` because `components/ui/button.tsx` uses it.
- Removed or de-exported unused internal value exports across auth helpers,
  navigation helpers, utilities, policy queries, rate-limit defaults, worker
  caps, X API internals, newsletter helpers, normalizer readability helpers,
  and cluster merge helpers.

### Current Tooling Policy

- `bun run verify` is the one-command local gate. It chains typecheck, lint,
  build, all three Knip gates, and the full Bun test suite.
- `bun run typecheck` runs standalone `tsc --noEmit` and should stay clean.
- `bun run code:dead` is the low-noise gate. It should stay clean.
- `bun run code:dead:exports` checks value exports. It should stay clean.
- `bun run code:dead:types` checks type exports. It should stay clean.

## Follow-Up Strategy

1. Keep operator scripts, migrations, tests, and Next route files in
   `knip.json` entry patterns.
2. Re-run `bun run code:dead` before every cleanup batch.
3. Run `bun run code:dead:exports` and `bun run code:dead:types` when doing an
   explicit boundary/export pass.
4. Delete only small, proven-safe batches with `bun run verify` and
   `git diff --check`.
