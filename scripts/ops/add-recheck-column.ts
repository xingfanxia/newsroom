/**
 * Idempotent DDL for the FIX-W7 read-budget fix (A2 — A.5 recheck waterline).
 * Adds one additive, nullable column via `ALTER TABLE ADD COLUMN` (SQLite has
 * no `ADD COLUMN IF NOT EXISTS`, so it is PRAGMA-guarded):
 *
 *   - items.last_recheck_at (INTEGER, ms) — last time A.5 neighbor-scanned this
 *     singleton and kept it. The singleton-recluster stage skips items rechecked
 *     within SINGLETON_RECHECK_COOLDOWN_HOURS, which removes the every-tick
 *     re-scan that dominated Turso rows_read.
 *
 * Additive + nullable ⇒ safe on the live DB and safe to re-run (existing column
 * skipped). No data backfill needed: NULL means "never rechecked", which the
 * waterline treats as immediately eligible, so the pipeline self-populates it.
 *
 * ⚠️ DEPLOY ORDERING — run this BEFORE (or with) the deploy that ships the A.5
 * waterline code. Vercel auto-deploys on push to main; the A.5 candidate SELECT
 * references last_recheck_at, so if the code ships first the cluster pipeline
 * throws `no such column: last_recheck_at` every tick (isolated by safeStage, so
 * the pipeline limps on but Stage A.5 silently no-ops until the column exists).
 * Because the column is additive + nullable, applying it EARLY is 100% backward-
 * compatible — the pre-deploy code never references it. So: apply here first,
 * then merge/deploy.
 *
 * Run: bun --env-file=.env.local scripts/ops/add-recheck-column.ts
 *   (or `bun run db:add-recheck-column`)
 *
 * NEVER use `db:push` for this (disabled — it false-diffs the F32_BLOB
 * embedding column and would drop items.embedding + the DiskANN index).
 */
import { closeDb, libsqlClient } from "@/db/client";

type ColumnAdd = { table: string; column: string; ddl: string };

const COLUMNS: ColumnAdd[] = [
  {
    table: "items",
    column: "last_recheck_at",
    ddl: "ALTER TABLE items ADD COLUMN last_recheck_at INTEGER",
  },
];

async function hasColumn(
  client: ReturnType<typeof libsqlClient>,
  table: string,
  column: string,
): Promise<boolean> {
  const info = await client.execute(`PRAGMA table_info(${table})`);
  return info.rows.some((r) => r.name === column);
}

async function main() {
  const client = libsqlClient();
  for (const c of COLUMNS) {
    if (await hasColumn(client, c.table, c.column)) {
      console.log(`skip  ${c.table}.${c.column} (already exists)`);
      continue;
    }
    await client.execute(c.ddl);
    console.log(`added ${c.table}.${c.column}`);
  }
  console.log("done");
}

if (import.meta.main) {
  main()
    .catch((err: unknown) => {
      console.error(
        "add-recheck-column failed:",
        err instanceof Error ? err.message : String(err),
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeDb();
    });
}
