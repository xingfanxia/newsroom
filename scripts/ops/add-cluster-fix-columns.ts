/**
 * Idempotent DDL for the 2026-07-12 cluster recall/precision remediation
 * (FIX-W567). Adds three additive columns via `ALTER TABLE ADD COLUMN`
 * (SQLite has no `ADD COLUMN IF NOT EXISTS`, so each is PRAGMA-guarded):
 *
 *   - sources.clustering_opt_out    (W5.2) — digest opt-out flag
 *   - clusters.no_content           (W5.3) — structural no-content flag
 *   - clusters.commentary_member_count (W6b) — count at last commentary
 *
 * All three are additive and nullable-or-defaulted, so this is safe to run on
 * the live DB and safe to re-run (existing columns are skipped). It does NOT
 * touch data — `bun run db:seed` populates clustering_opt_out from the catalog
 * afterward; no_content / commentary_member_count fill in as the pipeline runs.
 *
 * Run: bun --env-file=.env.local scripts/ops/add-cluster-fix-columns.ts
 *
 * NEVER use `db:push` for this (it's disabled — it false-diffs the F32_BLOB
 * embedding column and would drop items.embedding + the DiskANN index).
 */
import { closeDb, libsqlClient } from "@/db/client";

type ColumnAdd = {
  table: string;
  column: string;
  ddl: string;
};

const COLUMNS: ColumnAdd[] = [
  {
    table: "sources",
    column: "clustering_opt_out",
    ddl: "ALTER TABLE sources ADD COLUMN clustering_opt_out INTEGER NOT NULL DEFAULT 0",
  },
  {
    table: "clusters",
    column: "no_content",
    ddl: "ALTER TABLE clusters ADD COLUMN no_content INTEGER NOT NULL DEFAULT 0",
  },
  {
    table: "clusters",
    column: "commentary_member_count",
    ddl: "ALTER TABLE clusters ADD COLUMN commentary_member_count INTEGER",
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
        "add-cluster-fix-columns failed:",
        err instanceof Error ? err.message : String(err),
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeDb();
    });
}
