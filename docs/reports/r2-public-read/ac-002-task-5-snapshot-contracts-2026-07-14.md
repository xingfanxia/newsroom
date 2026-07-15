# AC-002 Task 5 evidence: snapshot contracts and canonical bytes

Date: 2026-07-14

Status: Task 5 complete. This is AC-002 foundation evidence only; AC-002 remains
`OPEN` until Task 6 adds independent frozen parity fixtures and the pure query
and derivation engine, then runs the criterion verifier.

## Accepted implementation

- Base: `739a59b682eec44234486697d8d9196ffae995f2`
- Commit: `feda5e424b432589cadf9b65378b428cab22610e`
- Reviewed base-to-head diff SHA-256:
  `7e8fef31d52e13a59831d91b2de3e0f6e2ca6b2a08deb437ed63d4c686ecb500`
- Stable patch ID:
  `8a591fdaa52deb7215af8bf11566c6b3be4e1589`
- Independent review: two final audits APPROVED with 0 Critical and 0 High
  findings.
- External effects: none. No production integration, Turso, R2, Cloudflare,
  deploy, publish, push, migration, or traffic replay ran.

## Proven contract surface

- Recursive strict schema-v1 records cover items, events, sources,
  newsletters, policy, canonical state, release pointers, manifests, artifact
  descriptors, and publisher run receipts.
- Persisted contracts reject private/raw reasoning, explanations, RSS/body
  inputs, embeddings, diagnostics, AI HOT payloads, user/saved/feedback/tweak,
  token/usage, and unknown fields rather than silently stripping them.
- Public eligibility fails closed for malformed, unenriched, excluded, or
  contentless items. Every event member must resolve exactly once and remain
  eligible; all eligible members are retained, and disabled-source history is
  preserved.
- Item URLs are HTTP(S)-only. Internal source locators are restricted to the
  exact safe allowlist represented by the source catalog contract test.
- Canonical bytes recursively sort object keys, preserve business-array order,
  normalize only explicit entity collections by ID, avoid input mutation,
  emit UTF-8 with exactly one trailing LF, and produce a fixed SHA-256 fixture.
- Canonical serialization rejects values or structures without a JSON contract,
  including undefined, BigInt, non-finite numbers, functions, symbols, dates,
  maps, sets, custom prototypes, accessors, sparse arrays, cycles, and symbol
  keys.
- Release pointers retain active and distinct previous manifest hashes; receipt
  invariants reject proofless nonzero scans and impossible dry-run
  upload/commit/ack states.
- Public `why featured` copy is derived only from already-public rubric facts;
  raw reasoning is neither persisted nor renamed into a public field.

## RED and review hardening

The initial contract/canonical/eligibility suite failed before the new modules
existed. Adversarial review mutations then reproduced and closed the following
gaps before acceptance: non-HTTP URL schemes; throwing pointer `safeParse`;
malformed eligibility inputs; missing, duplicate-resolved, or ineligible event
members; implicit undefined-tier fallback; nonzero scans without verified
index/plan evidence; and dry-run receipts that claimed upload, commit, pointer
advance, or acknowledgement.

## GREEN verification

```text
bun --no-env-file test tests/public-content
34 pass, 0 fail, 278 assertions

bun run typecheck
exit 0

bun run lint
exit 0

git diff --check
exit 0

bun run verify
typecheck / lint / Next production build / dead-files / dead-exports / dead-types: pass
1343 pass, 0 fail, 6774 assertions across 189 files
```

The final reviewer rerun additionally passed the focused eligibility/release
slice 16/16 with 97 assertions. Task 6 remains deliberately unstarted.
