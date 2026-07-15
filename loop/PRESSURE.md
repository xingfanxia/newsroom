# R2 Public-Read Pressure Weather

This file is a rendered view of `loop/STATE.md` `pressure_objects`; STATE is the
source of truth. Rendered for iteration 21 on 2026-07-14. Re-render and read it
before every iteration, then record `pressure_consulted` before making a
decision.

| ID | Source | Scope | Mode | Strength | Satisfied by | Violation | Expires | Status |
|---|---|---|---|---|---|---|---|---|
| P-public-db-zero | authored | anonymous GET/HEAD/RSC/API/RSS | constraint | high | AC-009 + AC-010 + AC-011 | blocks | criteria-met or AX change | active |
| P-rows-hard | authored | total Turso rows_read | constraint | high | AC-012 `<136986 rows/h` exact window | blocks | criteria-met or AX change | active |
| P-rows-ideal | authored | total Turso rows_read | preference | high | AC-012 `<13699 rows/h` exact window | owes explanation | met or retired by AX | active |
| P-safe-tests | mined | verification/integration | salience | low | AC-001 red/green receipts | owes proof | AC-001 pass | active |
| P-architecture-api | mined | module/import ownership | salience | low | AC-009 import/NFT receipts | owes explanation | AC-009 pass | active |
| P-metered-cap | authored | unattended cloud/integration work | constraint | high | write-ahead cap ledger | blocks | criteria-met | active |

Maintenance contract:

- Flush every mutation to STATE and re-render this file before the next decision.
- Re-test active/hardened constraints every pass; an untested wall degrades to burden.
- Pay, stale, retire, or harden only with the pre-registered tier-1/2 evidence.
- Merge duplicate backpressure by scope; cap in-force rows at 12 and ledger
  transitions at 5 per row.
- Pressure may reorder work but cannot erase an OPEN acceptance criterion or
  weaken its verifier.
