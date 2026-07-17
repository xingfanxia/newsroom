# Public Snapshot Operations

Status: implementation and local verification are complete on the R2
public-read feature branch. The Cloudflare R2 bucket `newsroom-public`, custom
domain `content.ax0x.ai`, scoped `/newsroom/` cache rule, production outbox
migration, first release, and real cache proof are complete. Vercel deployment,
traffic replay, cutover, rollback, and the stability windows remain in progress
under AX's explicit production authorization.
Those remaining deployment, replay, rollback, and observation steps have not run
yet; the receipts below distinguish completed work from pending gates.

## Ownership and invariants

```text
Turso (private source of truth)
  -> public_content_outbox
  -> authenticated incremental publisher
  -> R2 immutable objects + manifest
  -> current.json (written last with ETag CAS)
  -> anonymous HTML / RSC / JSON / RSS
```

- Anonymous requests need only `R2_PUBLIC_BASE_URL`; traffic must not scale
  Turso reads. There is no DB fallback and no public dual-read mode.
- Publisher, cron, admin, saved/feedback/tweak routes, bearer v1/MCP auth and
  semantic search remain allowed Turso consumers.
- A reader may use the pointer's previous release or its warm last-known-good
  release. If none validates, return controlled 503; never query Turso.
- The recurring publisher is proportional to outbox changes. The one full
  bootstrap is separately metered and may run exactly once.

## Release artifact layout

The manifest separates queryable canonical state from large item bodies:

```text
state/items/<00-7f>       128 slim item shards (`bodyMd: null`)
bodies/items/<00-7f>      128 aligned item-body shards
state/events/<00-7f>      up to 128 event shards
state/newsletters/<00-7f> up to 128 newsletter shards
state/sources             singleton source catalog
state/policies            singleton policy history
views/*                   materialized page and feed artifacts
search/lexical/<00-1f>    compact lexical metadata/text-excerpt shards
```

`state/items/<00-7f>` holds the slim canonical records, while each
`bodies/items/<00-7f>` entity contains only an item ID and a non-null Markdown
body. The numeric bucket is identical to the corresponding slim item bucket.
The publisher always emits all 128 body shards, including empty ones;
steady-state item changes rewrite only the matching slim and body buckets.
The first publisher tick against a pre-split manifest forces the one-time split
even when the outbox has no content changes. Before uploading, the incremental
publisher counts changed artifacts plus the manifest, pointer CAS, and receipt;
a plan above the 500-write cap fails without uploading artifacts or
acknowledging the outbox.

Canonical readers aggregate only `state/*`, so page/feed reads do not parse the
body shards. Item detail reads the body descriptor from the exact state release
and keeps that lookup release-pinned across a `current.json` flip. A legacy
release without body descriptors falls back to its inline `bodyMd`; an older
application can still parse a split release because slim items retain the
nullable field. Podcast detail materialization resolves the same split body
before publishing its view buckets. `/api/public/sources` reads and validates
the required `state/sources` singleton directly while preserving the
active-to-previous-to-last-known-good fallback ladder.

Archive page views materialize only the first 50 cards; older cards are read
from bounded feed segments when the user paginates. Lexical search reads the
compact v2 shard family, selects IDs, and hydrates only matching item/event
shards. The v2 reader remains backward-compatible with v1 lexical artifacts so
an application deploy can safely precede the next pointer publication.

## Environment and credentials

Vercel server environments require:

```text
R2_PUBLIC_BASE_URL=https://content.ax0x.ai
R2_BUCKET=newsroom-public
R2_ACCOUNT_ID=<account id>
R2_ACCESS_KEY_ID=<bucket writer key>
R2_SECRET_ACCESS_KEY=<bucket writer secret>
```

`R2_ENDPOINT` may override the derived HTTPS S3 endpoint. The browser receives
none of the writer values. Keep them out of `NEXT_PUBLIC_*`, logs, receipts,
shell history, and git. `TURSO_API_TOKEN` is needed only for named measurement
windows and must not be placed in Vercel runtime configuration.

The temporary Cloudflare setup/cache-rule tokens are not runtime dependencies.
After production verification, revoke them and remove plaintext download files.
Keep the R2 publisher credential only if it is scoped to this bucket; otherwise
replace it with a bucket-scoped key and rotate the broad key.

## Safe local verification

Ordinary development must use the hermetic runner, which strips production
Turso/R2/Cloudflare credentials:

```bash
bun run test -- tests/docs/public-snapshot-docs.test.ts
bun run verify:r2-public --criterion AC-009
bun run verify:r2-public --criterion AC-010
```

AC-009 proves source and compiled bundles are DB-free. AC-010 builds without
Turso, exercises all anonymous GET/HEAD/RSC surfaces and real browser hydration,
and requires zero connections to a poison Turso endpoint. Neither command
publishes or contacts production.

## Production gate

Stop unless the user has explicitly authorized the production gate. Record the
commit/deployment ID, a clean measurement window, the spend ledger, and receipt
directory before running any command. Per run, cap R2 writes at 500, public
requests at 10,000, transfer at 1 GiB, bootstrap at one, and intentional Turso
access to the named exact window.

Future production runs continue to require explicit AX authorization. This run
received that authorization at `2026-07-15T04:16:32Z`; it does not create a
standing authorization for later migrations, bootstraps, or cutovers.

Execute in this order; do not combine steps or infer success from a later one:

1. **Preflight.** Run the final local gate once on the unchanged diff. Confirm
   `content.ax0x.ai/newsroom/` still has the scoped cache rule and that no clean
   Turso measurement is already in progress.
2. **Install the outbox.** With production Turso variables explicitly loaded,
   run `bun scripts/ops/migrate-public-content-outbox.ts --apply`. Save its
   migration name/checksum receipt. Re-running is allowed only to confirm the
   same checksum and `applied:false`.
3. **Prepare producer/shadow.** Configure the scoped R2 variables for the
   operator and Vercel, but do not deploy the scheduled publisher or snapshot
   readers before a valid first pointer exists. The branch schedules
   `publish-public` at `12,27,42,57 * * * *` once deployed.
4. **Bootstrap once.** Prepare a schema-v1 canonical public-state JSON and its
   outbox high-water mark using the approved one-shot production export. The
   operator command is `bun run snapshot:export-bootstrap -- --apply --output
   <state.json> --page-size 500`; it creates the output exclusively with mode
   `0600`, validates the strict public schema, and reports only counts, hash,
   watermark, and query telemetry. Review that it contains no private fields.
   Create a mode-0600 bootstrap ledger:

   ```json
   {
     "goalVersion": "r2-public-read-v1-ec57c55fe111",
     "bootstrapSnapshots": { "limit": 1, "used": 0 },
     "objectWritesPerRun": 500
   }
   ```

   Then run `bun run snapshot:bootstrap -- --apply --state <state.json>
   --source-watermark <high-water> --spend-ledger <ledger.json>`. The operator
   refuses a second reservation. Save the run receipt and verify current,
   manifest, and object readback before continuing. The repeating cron must
   never be used as a hidden full materializer.

   The completed production run exported 8,730 items and produced release
   `r0-8c1c86004a59bbcb8eed` with 128 numeric buckets, 309 immutable artifacts,
   and 312 total writes. See
   `docs/reports/r2-public-read/production-bootstrap-export-2026-07-15.md` and
   `docs/reports/r2-public-read/production-r2-bootstrap-2026-07-15.md`.
5. **Probe real cache behavior.** Use a fresh Task-17 spend ledger and
   `bun run evidence:r2-cache -- --apply ...` against the real `current.json`
   and one immutable object. Require HTTPS, CORS, stable ETag, distinct pointer
   versus immutable TTLs, and second-request `CF-Cache-Status: HIT` with
   positive `Age`.

   The completed cache receipt is
   `docs/reports/r2-public-read/production-r2-cache-2026-07-15.json`: both the
   pointer and immutable manifest proved `MISS -> HIT`, stable ETags, positive
   `Age`, CORS, and distinct TTLs.
6. **Deploy, canary, and cut over.** Deploy after the valid first pointer exists,
   observe the scheduled incremental publisher in producer/shadow mode, and
   compare representative HTML, RSC, JSON and RSS outputs. Then switch
   anonymous routes as one deployment or a bounded route canary. A public
   request must read R2 only; never shadow-read Turso on the request path.
7. **Exercise failure and scale.** Run warm, cache-miss, cold-deploy and
   missing-object scenarios, including deterministic 1x/10x/100x corpora, with
   `evidence:load-public`. Pair each load window with an equal no-load Turso
   control using `evidence:turso-window`. Require zero unexpected 5xx and
   `load rows_read - control rows_read = 0`.
8. **Observe.** Keep a 48-hour stable period and capture one exact clean window
   of at least 24 hours. The hard total is `<136,986 rows/hour` (<100M/month),
   the preferred line is `<13,699 rows/hour` (<10M/month), and publisher scans
   must project below 5M/month. If the preferred line is missed, attribute the
   measured residual to cron/auth/MCP consumers; do not blame anonymous traffic.
   Save a `public-stability` receipt with the deployment/release IDs, exact
   start/end/duration, and zero publisher failures, unexpected 5xx, and
   controlled 503s.
9. **Aggregate receipts.** Point `R2_PUBLIC_EVIDENCE_MANIFEST` at the cache,
   load/control, clean-window, publisher, `stabilityReceipt`, and
   `rollbackReceipt` manifest entries. Run AC-004, AC-011, and AC-012, update
   this runbook and `docs/HANDOFF.md` with the exact measured projections, then
   run AC-013 and the final verifier in the same repo/deployment state. The
   shipped docs must use these exact labels so the final verifier can compare
   them to the manifest: `Total Turso projection: N rows/month`, `Publisher
   projection: N rows/month`, and `Preferred <10M/month target: met|not met`.

The evidence CLIs require both `--apply` and
`RUN_PRODUCTION_INTEGRATION=1` for non-loopback endpoints. Receipt files are
created exclusively (`wx`, mode 0600) so a later run cannot overwrite evidence.

## Monitoring

- Watch the timestamp and failure stage in `newsroom/v1/ops/runs/...`; four
  publisher ticks per hour should be succeeded or noop.
- Alert on stale `current.json`, repeated CAS conflicts, missing/invalid
  manifest or object hashes, controlled 503s, and a falling Cloudflare HIT rate.
- Run `snapshot:reconcile -- --max-artifacts <n>` as a bounded read-only check.
  Any failure requires an operator pause; reconciliation never mutates the
  pointer.
- Retention planning keeps at least seven releases and 30 days and always keeps
  active/previous. There is no automatic destructive garbage collector in this
  gate; inspect a deletion plan before separately authorized deletion.

## Rollback

- **Bad release:** conditionally replace `current.json` with the previously
  verified pointer using the current ETag. Never overwrite unconditionally and
  never point at an unverified manifest.
- **Bad application deployment:** roll back the Vercel deployment while keeping
  R2 releases intact.
- **R2/cache incident:** correct or disable only the scoped Cloudflare rule, or
  serve previous/last-known-good. Do not enable a DB fallback.
- **Publisher failure:** leave the pointer and outbox unchanged and retry the
  next bounded run after fixing the cause.
- **Rollback validation:** repeat the real cache probe and a representative
  HTML/RSC/JSON/RSS corpus, then record the deployment, pointer ETag, release ID,
  and receipt paths. Save a `public-rollback` receipt proving a conditional
  application deployment rollback plus a conditional pointer replacement
  between distinct releases/ETags, zero unexpected 5xx, positive representative
  request count, and cache revalidation; reference it as `rollbackReceipt` in
  the final manifest.

Do not delete R2 objects, revoke the active bucket writer, remove the outbox, or
remove legacy application code until the stability and final evidence gates
have passed.
