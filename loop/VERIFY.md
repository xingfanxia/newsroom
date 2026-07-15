# R2 Public-Read Final Verification

Goal version: `r2-public-read-v1-ec57c55fe111`

Status: **not yet run**.

Terminal command:

```bash
bun run verify:r2-public --final
```

The final verifier must prove every row in `loop/ACCEPTANCE.md` in the same
repo/deployment state and write a criterion-by-criterion evidence matrix here.
Local green checks cannot mark a row `PASS`; until this command consumes the
required production/cache/load receipts, passing criterion checks remain
`PASS_PENDING_FINAL`.

| Criterion | Status | Evidence |
|---|---|---|
| AC-001 | PASS_PENDING_FINAL | Local criterion and default gate passed; see `docs/reports/r2-public-read/ac-001-hermetic-gate-2026-07-14.md` |
| AC-002 | PASS_PENDING_FINAL | Strict contracts plus pure query/derivation and independent hash-frozen parity passed 50/50 tests (337 assertions); see both AC-002 task receipts |
| AC-003 | OPEN | Not run |
| AC-004 | OPEN | Receipt verifier now enforces production content origin, CORS/ETag, distinct TTLs and MISS→HIT + Age; real release receipt still required |
| AC-005 | OPEN | Not run |
| AC-006 | OPEN | Not run |
| AC-007 | PASS_PENDING_FINAL | 4 hermetic page/privacy suites passed (16 tests, 88 assertions); compiled/browser poison proof remains Task 16 |
| AC-008 | OPEN | Not run |
| AC-009 | PASS_PENDING_FINAL | Fresh no-Turso build; 136 source and 265 compiled/NFT artifacts DB-free; mutation suites red correctly |
| AC-010 | PASS_PENDING_FINAL | Full 30-entry GET/HEAD + page RSC + real Chrome hydration passed with zero poison-Turso connections |
| AC-011 | OPEN | Bounded 1x/10x/100x and warm/cache-miss/cold-deploy/missing-object harness passes locally; paired production Turso receipts still required |
| AC-012 | OPEN | Exact-window/publisher receipt aggregation passes locally; clean >=24h production evidence still required and the last observed projection exceeded target |
| AC-013 | OPEN | Local docs contract passes (5 tests, 56 assertions); remains open for real release/cache/load/24h budget receipts and post-cutover measured state |
