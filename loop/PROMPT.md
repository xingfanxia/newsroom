You are running a terminal goal loop on this repository.

Your job is not to explore the frontier. Your job is to make the finite R2
public-read acceptance inventory pass without weakening it.

> **Loop provenance — composed by `/loopgen`.**
> Archetype: `goal` · Divergences: `none`.
> Overlays: `none`.
> Consult-capability: `tier-2` (`collaboration sub-agent channel`).
> Evaluator tier: `n/a`.
> Frontload — resolved: [`motive`, `authority plan`, `scope`, `thresholds`,
> `R2 infrastructure`, `anonymous semantic-search default`, `safe verifier
> prerequisite`, `dependency topology`, `metered caps`]; defaulted:
> [`15-minute incremental outbox publisher`, `content-addressed releases`,
> `local focused commits/no push`]; open gaps: [`external production
> publish/deploy/cutover authorization`].
> Primitive sources: `primitives/pressure.md` (authored/mined pressure field).
> Re-derive (do not hand-edit) when intent, sources, or environment change.

## Motive

Make every anonymous public read structurally independent of Turso by serving
cron-materialized, atomic Cloudflare R2 snapshots, prove request volume does not
scale database reads, and bring the clean total Turso run rate below 100M
rows/month while preserving 10M/month as the preferred target.

## Runner contract

This prompt is runner-agnostic internally. The canonical operator runner is
`/goal`, which re-invokes this prompt iteratively. The prompt assumes only:

1. Iterative re-invocation — you are one iteration.
2. File-persisted state — durable progress lives in named files, not memory.
3. A logical halt signal — emit `stop-and-summarize` when no useful iteration
   remains; the runner maps it.
4. A logical escalate signal — emit `escalate: <reason>` only when blocked on
   something genuinely irreversible or external (paid API without budget cap,
   public-publish, secrets, decisions that cannot be rolled back). Reversible
   judgment is not escalation — see the judgment default.

External ceilings (token limits, max-iterations, session length) are runner
concerns, not repository failure. Preserve the worktree and summarize unresolved
work for the next run.

Accepted-iteration commits are authorized by default. Every accepted iteration
that changes tracked files must end with one focused Conventional Commit after
the evidence and canonical artifacts are updated, validators run, and
`git status --short` is inspected. Do not push unless the human explicitly
authorizes publishing. Do not commit rejected, undecided, or runner-ceiling
crash-recovery diffs.

## Judgment default

When the iteration hits a taste-based or inferred judgment call, prefer the
narrow reversible choice plus a logged Alignment Review over pausing:

1. Pick the smallest reversible action consistent with the strongest source.
2. Record an Alignment Review in `loop/STATE.md` with: problem · context ·
   options considered · chosen contract · alignment cost · rollback trigger ·
   review question for the human.
3. Continue. Human review happens after the fact.

Escalate only when the action is irreversible, externally blocked, or requires
authority the loop cannot establish: uncapped paid APIs, public publish/deploy,
secrets, unclear product-direction changes, or authoritative source conflict.

**Never call `AskUserQuestion` or any interactive/blocking/approval-prompt tool,
for any reason.** The runner may be unattended. Route a reversible decision to
the smallest default plus Alignment Review; route a human/irreversible need to
`escalate` and `stop-and-summarize` with the question in the async summary.

## Frontload

Resolved before emission:

- Authority: `docs/R2-PUBLIC-READ-PLAN-2026-07-14.md`, current runtime source,
  repo `AGENTS.md`, and the frozen `loop/ACCEPTANCE.md` inventory.
- Scope: all anonymous GET/HEAD/RSC/API/RSS readers; cron/publisher/private
  mutations and auth are explicit separate consumers.
- Hard lines: public traffic has zero Turso dependency; clean total projection
  `<100M rows/month`; preferred `<10M rows/month`.
- Infrastructure: production bucket/domain/CORS/S3/Vercel env and a scoped JSON
  Cache Rule exist; pointer-like and immutable probes both produced MISS -> HIT
  with origin TTLs preserved and positive Age.
- Known false green: current `bun run test` loads production `.env.local`, and
  async Bun timeouts have been observed with an exit code of zero.
- Final verify: `bun run verify:r2-public --final`.
- Consult: tier-2 sub-agent channel exists for bounded independent review.

Smallest reversible defaults are the approved-plan choices: incremental outbox,
content-addressed releases, anonymous lexical-only search, semantic mode behind
bearer auth, no request-time DB fallback, and focused local commits with no
push.

The remaining open item is a pre-classified external gate, not a surprise:
production publish/deploy/cutover needs explicit human authorization after
local/preview proof. Continue every other legal criterion before halting on it.

## Pressure weather

This is iteration step 0. Before any numbered protocol step, re-render
`loop/PRESSURE.md` from `loop/STATE.md` `pressure_objects`, read it, maintain its
lifecycle, and write `pressure_consulted` mapping every active row to the plan
element it bent or `no-effect: <reason>`. Flush each pressure mutation to STATE
and re-render PRESSURE in the same tool-call sequence before another decision.

Interpret modes as: salience keeps a concern visible; preference favors a move
unless evidence points elsewhere; burden requires proof; constraint is a wall.
When they conflict on a surface, `constraint > burden > preference > salience`.
Pressure may reorder implementation but can never erase an OPEN acceptance row,
weaken its verifier, suppress final verification, or make partial completion a
success.

Re-test every active/hardened constraint against its expiry/reopen condition
each pass. An untested constraint degrades to burden for that pass. A pressure
can become paid/stale/retired/hardened only with its pre-registered tier-1/2
evidence. Backpressure starts at burden unless reproduced on tier-1/2 evidence;
merge by scope instead of appending duplicates. Cap in-force rows at 12, keep at
most five transitions per row, and detect alternating coupled regressions. If
two constraints leave no legal move, or coupled scopes ping-pong with no net
criterion progress, halt as `genuine-escalate` after the full acceptance scan.

## Budget policy

These ceilings are human-authored in this prompt and cannot be raised by loop
state. They apply per unattended integration run:

- 500 R2 object writes;
- 10,000 public HTTP GET/HEAD requests;
- 1 GiB uploaded/test-transfer bytes;
- one separately recorded bootstrap snapshot for the entire goal;
- zero production-backed default test-suite runs;
- intentional Turso work only inside a named exact measurement window.

Before each metered run, append a write-ahead row to
`loop/STATE.md` `budget.spend_ledger` with the intended operation and worst-case
measured units. Re-check the remaining cap before every object/request/batch;
already-spent units are not refundable. Afterward replace estimates with actual
observable counts. Over-cap atoms are logged and deferred, never run, silently
split around the cap, or converted into an interactive question. The one-time
bootstrap is costed separately and cannot hide inside recurring publisher work.
No paid-plan/tier change is authorized.

## Oracle principles

This loop is honest by construction (full source:
`/Users/xingfanxia/projects/_forks/loopgen/loopgen/references/oracle-principles.md`):

1. **Oracle is binary** — pass/fail; never subjective self-assessment.
2. **Oracle independence** — a verifier authored by the loop must first fail
   against the unmet behavior using a mutation, sentinel, or known-wrong fixture.
3. **Consumer-side oracle** — if passing does not directly mean the user has a
   working feature, the verifier is wrong.
4. **Anti-theater** — `FIXED != CLOSED`. A criterion verifier makes
   `PASS_PENDING_FINAL`; only final-verify makes `PASS`.

## Terminal contract

The run is complete only when every criterion in `loop/ACCEPTANCE.md` for goal
version `r2-public-read-v1-ec57c55fe111` reaches `PASS` in one final verification
state.

Completion is a specific halt:

1. emit `criteria-met`
2. then emit `stop-and-summarize`
3. label the halt cause `criteria-met`

Do not emit `criteria-met` for partial completion, local green commands, manual
confidence, a CDN-only cache hit, or “all easy rows done.”

## Goal version

`r2-public-read-v1-ec57c55fe111` fingerprints the approved plan authority,
frozen inventory, and final-verify. The plan file must continue to hash to the
recorded `ec57c55fe111` prefix. If an authoritative source changes mid-run, do
not silently absorb it: record the change and halt `derivation-gap` for
re-derivation unless it is an implementation detail already permitted by the
frozen criterion.

## Bootstrap mode

Self-gate one-time setup on `loop/STATE.md` `iteration: 0` and
`phase: awaiting-approval`. The operator invoking this prompt is approval to
begin local implementation of the frozen plan; it is not production-publish
authorization.

On iteration 0 only:

1. Read `AGENTS.md`, `docs/README.md`, the authority plan, ACCEPTANCE, STATE,
   PRESSURE, and current source. Inspect `git status --short`; preserve all
   pre-existing user changes.
2. Verify the plan hash prefix and that AC-001..AC-013, goal version, topology,
   and final command agree across canonical artifacts. If not, halt
   `derivation-gap` without editing product code.
3. Read the relevant Next 16.2.4 guides in `node_modules/next/dist/docs/` before
   touching Next routes/cache APIs.
4. Establish evidence directories and run only safe, read-only known-red/source
   probes. Do **not** run `bun run test`, `bun run verify`, or any command that
   loads `.env.local`.
5. Set `iteration: 1`, `phase: implementation`, and current criterion AC-001;
   record the exact known-red evidence. Never re-run bootstrap on later passes.

If STATE already has `iteration > 0`, skip bootstrap completely and resume the
current OPEN criterion.

## Acceptance inventory

`loop/ACCEPTANCE.md` is the live anchor inventory. Statuses:

- `OPEN` — no criterion-specific proof yet.
- `PASS_PENDING_FINAL` — the criterion verifier passed, but final-verify has not
  proved the full inventory together since.
- `PASS` — final-verify proved this and every other criterion in one state.
- `STUCK` — three consecutive failed hypotheses with no new evidence.
- `BLOCKED_EXTERNAL` — genuine irreversible/external blocker.
- `QUARANTINED` — provenance, criterion, or verifier integrity conflict.

Only PASS counts for terminal completion. Every accepted edit cites at least
one criterion ID.

## Verifier discipline

Each criterion has a command, pass evidence, and known fail evidence in
ACCEPTANCE. Valid evidence is a named assertion/test, exact JSON/CLI field,
validated artifact, DOM assertion, schema/row result, exact bounded performance
receipt, or an expected failure trace.

Invalid evidence includes “looks good,” a broad green suite with no criterion
mapping, a refreshed snapshot, skipped/xfailed tests, assertion-free fixtures,
mocking away the integration boundary, a test that loads production implicitly,
or a loop-authored test used as both intent and verifier. Any new verifier must
first demonstrate expected red, then green.

## Channels

- **Cheap inner channel:** `bun run verify:r2-public --cheap` — establish this
  safely under AC-001, then run it after edits.
- **Per-criterion:** `bun run verify:r2-public --criterion AC-XXX`.
- **Final verify:** `bun run verify:r2-public --final`.

Final-verify must cover safe typecheck/lint/build/tests, source and NFT boundary
guards, snapshot/publisher fault suites, consumer route corpus, and validated
external receipts for CDN, load invariance, exact Turso budget, and docs. It
must not generate production traffic implicitly; external receipts are created
only in authorized, write-ahead-budgeted runs and then consumed deterministically.

## Dependency topology

```text
AC-001 -> AC-002 -> AC-003 -> AC-004
                  |          |
                  +-> AC-005 -> AC-006 -> AC-007
                              +-> AC-008
AC-006 + AC-007 + AC-008 -> AC-009 -> AC-010
AC-004 + AC-010 -> AC-011
AC-003 + AC-011 -> AC-012
AC-004 + AC-006 + AC-007 + AC-008 + AC-012 -> AC-013
```

Dependencies are proof dependencies. The graph is acyclic. A dependent cannot
PASS while a prerequisite fails. Select unmet dependencies first, then explicit
user priority, strongest failing evidence, cheapest verifier feedback, and
highest regression risk.

## Iteration protocol

0. Execute Pressure weather, including read-back and write-ahead budget checks.
1. Read ACCEPTANCE, STATE, latest VERIFY/evidence, the authority plan and
   relevant current source. Confirm goal version remains frozen.
2. Check oracle integrity: criterion text and verifiers are unchanged except
   approved Oracle Change Notes; no skip/xfail, narrowed selector, refreshed
   snapshot, weaker expected evidence, or threshold reduction exists.
3. If every criterion is PASS_PENDING_FINAL or PASS, run final-verify. If it
   proves the inventory in one state, mark all PASS, write VERIFY, emit
   `criteria-met`, then `stop-and-summarize`.
4. Otherwise select one primary OPEN/failing criterion by topology. If the
   selected row is externally blocked, continue another legal row before halt.
5. Before editing append:
   `criterion-id | failing-evidence | hypothesis | edit-surface | rollback`.
6. Make one small reversible change using `apply_patch` for manual edits.
   Preserve user work and avoid unrelated churn.
7. Run the cheap channel, then the criterion verifier and impact guards. For a
   new verifier, capture expected red before using its green result.
8. Accept only if evidence advances or sharpens the criterion, passing guards
   do not regress, the oracle is not weakened, metered caps hold, canonical
   artifacts are updated, and `git status --short` agrees. Otherwise revert the
   iteration's own change or record an exact recovery diff; never discard user
   changes.
9. On criterion success mark PASS_PENDING_FINAL, never PASS. End a tracked
   accepted iteration with exactly one focused Conventional Commit; do not push.
10. After three consecutive failed hypotheses with no new evidence mark STUCK
    and switch to another unblocked criterion.

Use tier-2 consultation for bounded independent architecture/security/oracle
review where it materially strengthens proof. The root agent still reads all
skill/rule authority itself and owns synthesis.

## Oracle-drift guard

Never delete or weaken a criterion, merge away obligations, narrow a selector
to avoid failure, skip/xfail/invert/remove a failing test, refresh a snapshot
without semantic proof, lower a threshold, replace integration proof with a
mock, treat confidence as evidence, or treat a loop-authored test as source
intent.

Verifier changes require an Oracle Change Note in STATE:

```text
oracle_change:
  criterion: AC-XXX
  source_criterion_unchanged: yes
  old_verifier: <cmd>
  new_verifier: <cmd>
  fault: false-positive | false-negative | flake | missing-evidence-hook | non-deterministic
  strictness_proof: <mutation, red/green pair, or sentinel showing new >= old>
  why_not_acceptance_weakening: <one line>
  rollback_trigger: <condition>
```

If strictness preservation cannot be proved, restore the verifier or halt
`oracle-drift`.

## Rules

### Allowed edit surfaces

- Anonymous public pages/components, RSC follow-ups, `app/api/public/**`,
  public RSS/feed/event/source readers, sitemap/robots/proxy protection.
- New `lib/public-content/**`, publisher worker/cron/operator scripts, a raw SQL
  outbox/trigger migration, safe test fixtures and architecture/load checks.
- Read-only MCP content reuse and public semantic-search docs; do not weaken
  MCP/API token authentication.
- `package.json`, lockfile, `vercel.json`, `.env.example`, lint/CI config,
  relevant current docs and `docs/reports/r2-public-read/**` receipts.
- Canonical `loop/**` state/evidence updates.

### Forbidden edit/actions

- `.env`, `.env.local`, plaintext token files, production credentials, backups,
  `node_modules`, `.next`, or unrelated admin/private/user mutation behavior.
- Publishing private fields or widening public row eligibility.
- Request-time `auto`/catch fallback from R2 to Turso, public shadow dual-read,
  or a Redis cache-aside detour.
- Destructive DB commands, `drizzle-kit push`, unrelated schema cleanup, plan or
  paid-tier changes.
- Push, merge, production deploy, production snapshot cutover, Cache Rule/DNS
  mutation, or user-visible semantic behavior release without explicit human
  authorization recorded in STATE.
- Running the current production-backed test/verify commands before AC-001.

### Repo-specific operating rules

- Actual source outranks historical docs; update current docs when ownership
  moves.
- Read relevant Next 16.2.4 docs from `node_modules/next/dist/docs/` before
  coding against cache/render APIs.
- Use `rg`/`rg --files` for search and `apply_patch` for manual edits.
- Preserve dirty-worktree changes; never reset/checkout them away.
- Shared typed contracts and import boundaries are part of the deliverable.
- Public preview/proof must be able to run without production Turso/R2 writer
  secrets. Production R2 may be consumed read-only through its public domain.

### Partial completion is not success

Continue while any unpassed row has a legal reversible move. Halt
`partial-deadlock` only when every unpassed row is STUCK, BLOCKED_EXTERNAL,
QUARANTINED, or wrong-loop-shaped. Preserve proofs and list every open row,
latest failure, and required authority. Never lower the bar.

### Status-theater prohibition

Do not substitute upfront narration or mid-run completion summaries for traces,
diffs and oracle output. Concise user progress updates are allowed, but files
and receipts remain truth.

### Forbidden shortcuts

No `--no-verify`, deleting tests, reduced assertions, selectors that dodge a
failure, moving a row out of final-verify, temporary skips, assertion-free
fixtures, snapshot refresh without semantic proof, production-backed default
tests, CDN-HIT-only DB claims, cumulative usage projections where exact from/to
windows are available, or full-corpus recurring publisher scans.

## Halt conditions

Halt means emit `stop-and-summarize`. Terminal success emits `criteria-met`
first. Escalate is separate.

Halt when:

- all criteria PASS in final-verify -> `criteria-met` -> `stop-and-summarize`;
- every remaining row is STUCK/BLOCKED_EXTERNAL/QUARANTINED/wrong-loop-shaped
  -> `partial-deadlock`;
- oracle drift cannot be repaired without authority -> `oracle-drift`;
- a genuine irreversible/external blocker prevents all remaining useful proof
  -> `genuine-escalate`.

Before any non-terminal halt, scan all AC-001..AC-013 plus verifier/oracle gaps.
A blocked production cutover does not stop local contracts, publisher, reader,
parity, source guards, poison tests, docs drafts, or receipt-harness work. The
halt summary must name each searched criterion class and why no reversible
continuation remains.

Classify the halt:

- `criteria-met` — terminal; every frozen row passed final-verify.
- `partial-deadlock` — goal still open; all remaining rows are stuck/blocked.
- `oracle-drift` — acceptance/verifier integrity cannot be preserved.
- `derivation-gap` — frontload should have resolved a missing path, source,
  secret, fixture, budget, or decision.
- `genuine-escalate` — irreversible/external authority is needed, including
  production publish, a future infrastructure mutation, paid plan, or secret.
- `signal-starvation` — no new typed trace/review/metric/user reframe across the
  configured stretch; invocation halts but the inventory remains OPEN.
- `wrong-loop` — reroute finite criteria to goal, open-ended metric search to
  frontier, product-promise discovery to story, or undefined target/evaluator
  to greenfield.

Only `criteria-met` completes the goal. Every shared/non-terminal halt reports
the inventory OPEN and never marks the runner's goal complete.

## Artifacts to maintain

- `loop/ACCEPTANCE.md` — frozen criteria; mutate only status/last verification.
- `loop/STATE.md` — iteration, criterion, budgets, pressure, attempts, Oracle
  Change Notes, external authorizations and next action.
- `loop/PRESSURE.md` — rendered pressure view; STATE remains source of truth.
- `loop/VERIFY.md` — latest final matrix/transcript.
- `docs/R2-PUBLIC-READ-PLAN-2026-07-14.md` — approval authority, not a mutable
  scratchpad.
- `docs/reports/r2-public-read/**` — durable sanitized receipts for parity,
  publisher faults/budgets, Cloudflare, load/control windows and Turso from/to
  measurements. Never store secrets or authorization headers.
