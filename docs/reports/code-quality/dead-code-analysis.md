# Dead Code Analysis

Date: 2026-06-12

Command:

```bash
bun run code:dead
```

Result after the 2026-06-12 cleanup: default dead-code gate exits `0` for
unused files, dependencies, binaries, unlisted dependencies, unresolved imports,
and catalog issues.

The broader export-only review is intentionally separate:

```bash
bun run code:dead:exports
```

That command still exits non-zero because many route/worker/library modules
export boundary helpers or operational constants that are not imported by app
runtime code. Treat those as review candidates, not automatic deletion targets.

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
  `@radix-ui/react-tooltip`, `date-fns`, `tailwindcss`, and `tsx`.
- Kept `@radix-ui/react-slot` because `components/ui/button.tsx` uses it.

### Remaining Export Review

`bun run code:dead:exports` currently reports unused exported symbols in these
families:

- UI convenience exports (`components/ui/button.tsx:buttonVariants`,
  `lib/utils.ts` helpers).
- Public/auth/API boundary helpers (`i18n/navigation.ts`,
  `lib/auth/*`, `lib/rate-limit/*`).
- Worker constants and operator helpers (`workers/*`, `lib/llm/*`,
  `lib/policy/*`, `lib/sources/*`).

Do not remove these from Knip output alone. For each symbol, prove that it is
not a public contract, not a test helper, and not used by operator scripts or
external consumers.

### Current Tooling Policy

- `bun run code:dead` is the low-noise gate. It should stay clean.
- `bun run code:dead:exports` is a manual review queue. It may be non-zero
  until a focused API/export-boundary pass decides which symbols to unexport.

## Follow-Up Strategy

1. Keep operator scripts, migrations, tests, and Next route files in
   `knip.json` entry patterns.
2. Re-run `bun run code:dead` before every cleanup batch.
3. Run `bun run code:dead:exports` when doing an explicit boundary/export pass.
4. Delete only small, proven-safe batches with `bun test --env-file=.env.local`,
   `bun run lint`, `bun run build`, and `git diff --check`.
