# Dead Code Analysis

Date: 2026-06-12

Command:

```bash
bunx knip --reporter compact
```

Result: `knip` exited non-zero because it found candidates. No files were
deleted from this report alone; this repo intentionally keeps many one-shot
operator scripts that are not imported by app code.

## Interpretation

### Safe To Inspect First

These are likely low-risk cleanup candidates, but still need a focused diff and
verification before removal:

- UI primitives reported unused: `components/ui/badge.tsx`,
  `components/ui/card.tsx`, `components/ui/tabs.tsx`.
- Source table row component: `components/sources/source-row.tsx`.
- Small utility exports reported unused: `lib/utils.ts` helpers,
  `lib/items/collections.ts:INBOX_COLLECTION`.

### Caution

These are not safe to delete from import analysis alone:

- `scripts/ops/*` and `scripts/migrations/*`: many are operator entry points
  invoked directly from the shell, handoffs, or runbooks.
- `lib/auth/api-token.ts` exports: API/MCP auth surface; some exports are public
  contracts or test helpers.
- `workers/*` constants: many are asserted from tests or used as operational
  knobs.
- `lib/llm/index.ts` exports: public LLM facade; some exports are deliberately
  kept for probes, scripts, or tests.

### Danger / Do Not Delete Without Owner-Level Review

- Dependencies reported unused: Radix packages, `date-fns`, `tsx`.
  These may be present for UI patterns, dynamic imports, or upcoming work.
- `lib/search/tavily.ts` and `lib/backfill/*`: deferred integrations and
  backfill helpers. Remove only after confirming product direction.

## Follow-Up Strategy

1. Add a `knip` config that treats `scripts/ops/**`, `scripts/migrations/**`,
   tests, and public route/helper entry points as project entries.
2. Re-run `knip` after config to separate true dead code from CLI entry points.
3. Delete only SAFE candidates one small batch at a time, with `bun run lint`,
   relevant tests, and `bun run build`.
