# AC-007 Task 3 evidence: saved boundary and calendar prefetch

Date: 2026-07-14

Status: partial local evidence only. AC-007 remains `OPEN` until anonymous
HTML/RSC and follow-up reads are snapshot-backed and the final browser/poison
and eligibility proofs pass.

## Accepted implementation

- Commit: `8c758a3 fix: protect saved data and disable calendar prefetch`
- Reviewed diff SHA-256:
  `9471e6b7c724d923f4087fda724eb2835a81ecb587764b03183fac3b030d27d4`
- Independent review: APPROVED with no findings.
- External effects: none. No production integration, Turso, R2, Cloudflare,
  deploy, publish, push, or traffic replay ran.

## Proven behavior

- Anonymous saved-page authorization redirects before `searchParams`, locale
  setup, user upsert, or any of the seven saved/chrome data dependencies. An
  injectable production boundary records exactly zero downstream calls.
- Anonymous saved export returns HTTP 401 with
  `{ "ok": false, "error": "auth_required" }` before request/export-body logic.
- The optimistic Proxy shares the exact cookie identity parser without a direct
  or transitive DB/session import; hard page and route checks remain authoritative.
- Real Proxy tests cover locale-prefixed saved redirect, unprefixed locale
  negotiation, and the `/en/savedness` false-positive boundary.
- Saved locale pages are absent from sitemap and explicitly disallowed in robots.
- Every CalendarGrid date-cell and clear-filter Link sets `prefetch={false}`.
- Authenticated saved collection selection and locale-aware loading remain green.

## Verification

```text
bun run test -- tests/privacy/saved-boundary.test.ts tests/feed/calendar-prefetch.test.tsx
10 pass, 0 fail, 57 assertions

bun run typecheck
exit 0

implementer: bun run verify
1207 pass, 0 fail (plus typecheck, lint, Next build, and Knip gates)
```

The global desktop/mobile saved navigation remains unchanged by design; this
task's frozen discovery slice is sitemap/robots. Anonymous navigation is safe
because both Proxy and the page hard boundary deny it before saved DB work.
