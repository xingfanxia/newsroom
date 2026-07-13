/**
 * One-off (W5.2 / FIX-W567 deploy): set clustering_opt_out = 1 on the digest
 * sources, WITHOUT running the full `db:seed`.
 *
 * WHY NOT db:seed: seed-sources.ts upserts the WHOLE catalog and would clobber
 * config columns that carry manual prod drift — notably it resets
 * ai-chatgroup-daily.curated back to false (dropping AI 群聊日报 from the /curated
 * 严选 tab, whose curated=1 is manual prod state not encoded in catalog.ts), and
 * re-asserts enabled/priority/tags + disables catalog-orphan sources. The ONLY
 * data #42/W5.2 actually needs is clustering_opt_out=1 on the digest sources —
 * the runtime consumer (workers/cluster/clustering-eligibility.ts) reads the DB
 * column directly. So this touches exactly those rows and nothing else.
 * (Pre-flight audit 2026-07-13; see docs/FIX-W7-read-budget-2026-07-12.md.)
 *
 * Targets are DERIVED FROM THE CATALOG (sources with clusteringOptOut === true),
 * so this stays correct if the digest set changes — one source of truth.
 *
 * SAFE BY DEFAULT: dry-run (read-only) unless `--apply` is passed. Idempotent —
 * a re-run only updates rows not already at 1 (0 rows once applied). Turso is the
 * only data copy — back up (scripts/ops/db-dump.ts) before `--apply`.
 *
 * Run (preview): bun --env-file=.env.local scripts/migrations/set-digest-clustering-optout-20260713.ts
 * Run (apply):   bun --env-file=.env.local scripts/migrations/set-digest-clustering-optout-20260713.ts --apply
 */
import { closeDb, libsqlClient } from "@/db/client";
import { sourceCatalog } from "@/lib/sources/catalog";

async function main() {
  const apply = process.argv.includes("--apply");
  const client = libsqlClient();

  const targets = sourceCatalog
    .filter((s) => s.clusteringOptOut === true)
    .map((s) => s.id);

  if (targets.length === 0) {
    throw new Error(
      "no catalog sources have clusteringOptOut=true — refusing to run",
    );
  }
  const placeholders = targets.map(() => "?").join(", ");

  // Read current state (proves the mutation is scoped + curated is untouched).
  const before = await client.execute({
    sql: `SELECT id, clustering_opt_out, curated, enabled
          FROM sources WHERE id IN (${placeholders}) ORDER BY id`,
    args: targets,
  });
  const foundIds = new Set(before.rows.map((r) => String(r.id)));
  const missing = targets.filter((id) => !foundIds.has(id));

  console.log(`${apply ? "APPLY" : "DRY-RUN"} — digest opt-out targets (from catalog): ${targets.join(", ")}`);
  if (missing.length > 0) {
    console.log(`  WARNING: target id(s) NOT in prod sources: ${missing.join(", ")}`);
  }
  console.log("  current state (id | clustering_opt_out | curated | enabled):");
  for (const r of before.rows) {
    console.log(
      `    ${r.id} | opt_out=${r.clustering_opt_out} | curated=${r.curated} | enabled=${r.enabled}`,
    );
  }

  if (!apply) {
    const need = before.rows.filter((r) => Number(r.clustering_opt_out) !== 1).length;
    console.log(`  would set clustering_opt_out=1 on ${need} row(s); ${before.rows.length - need} already set. (dry-run — no writes)`);
    return;
  }

  const res = await client.execute({
    sql: `UPDATE sources
          SET clustering_opt_out = 1, updated_at = (strftime('%s','now') * 1000)
          WHERE id IN (${placeholders}) AND clustering_opt_out != 1`,
    args: targets,
  });
  console.log(`  updated ${res.rowsAffected} row(s)`);

  const after = await client.execute({
    sql: `SELECT id, clustering_opt_out, curated, enabled
          FROM sources WHERE id IN (${placeholders}) ORDER BY id`,
    args: targets,
  });
  console.log("  after (curated MUST be unchanged from 'current' above):");
  for (const r of after.rows) {
    console.log(
      `    ${r.id} | opt_out=${r.clustering_opt_out} | curated=${r.curated} | enabled=${r.enabled}`,
    );
  }
  console.log("done");
}

if (import.meta.main) {
  main()
    .catch((err: unknown) => {
      console.error(
        "set-digest-clustering-optout failed:",
        err instanceof Error ? err.message : String(err),
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeDb();
    });
}
