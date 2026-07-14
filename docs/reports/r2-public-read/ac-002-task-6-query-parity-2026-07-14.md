# AC-002 Task 6 evidence: pure snapshot queries and parity

Date: 2026-07-14

Status: Task 6 complete; AC-002 is `PASS_PENDING_FINAL`.

## Accepted implementation

- Added one framework-free engine over validated `CanonicalPublicState` for
  public feed queries, event members, shell/calendar/source aggregates, daily
  columns, and all main/newsletter/legacy RSS artifacts.
- The five runtime modules import no database client, Next runtime, process
  environment, filesystem, network client, or request-time `fetch`.
- Query behavior preserves both locales, inclusive featured/P1 tiers, canonical
  event-lead deduplication, source-ID precedence, source metadata filters,
  exclusive date bounds, injected-clock today/recency behavior, SQLite LIKE
  `%`/`_` wildcards, ordering, page totals, offsets, limits, and day caps.
- Rolling shell/X/calendar views derive from the injected clock, so time passage
  does not require rebuilding the canonical corpus.
- RSS rendering is byte-frozen and uses UTC explicitly for deterministic
  newsletter ranges across build hosts.

## Independent oracle and expected RED

- The canonical corpus is hand-authored and frozen at SHA-256
  `e418c8d4ad6bb65555593d84cd6f9279a4225b175190e49fb61e96fd916cc6fa`.
- Expected RSS hashes were generated from the pre-change `toStory`, RSS item
  serializers, channel metadata, and shared XML renderer under `TZ=UTC`, using
  independently frozen expected IDs rather than the new query implementation.
- Known-wrong exact-tier, all-event-member, source-filter-AND, inclusive upper
  date, literal wildcard, and GUID mutations demonstrably differ from the
  frozen expectations.
- Before implementation the focused suite failed because `query`, `derive`,
  and `rss` modules did not exist; the AC-002 command also failed with
  `Criterion is not implemented yet: AC-002`.

## GREEN verification

```text
bun run verify:r2-public --cheap
16 pass, 0 fail
CHEAP_COMPLETE

bun run verify:r2-public --criterion AC-002
50 pass, 0 fail, 337 assertions across 8 hermetic suites
5 public query modules verified framework/DB/I/O free
hostile inherited Turso/R2 credential sentinels stripped
AC-002_COMPLETE

bun run typecheck
exit 0

git diff --check
exit 0
```

External effects: none. No production integration, Turso, R2, Cloudflare,
deploy, publish, push, migration, bootstrap, or traffic replay ran. Metered
spend remained zero.
