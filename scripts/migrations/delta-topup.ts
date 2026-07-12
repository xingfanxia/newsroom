/* Delta top-up after the main copy: prod crons kept writing to Supabase
 * during the bulk copy, so pull any rows with id > max(turso id) per
 * integer-PK table. Run from newsroom repo root:
 *   bun --env-file=.env.local <path>/delta-topup.ts
 *
 * UPDATE drift (items enriched/clustered in pg after the snapshot) is NOT
 * reconciled here — the Turso-side crons self-heal it (claim predicates key
 * off enriched_at/clustered_at IS NULL, which the snapshot copy preserved).
 */
import postgres from "postgres";
import { createClient, type InValue } from "@libsql/client";

const TABLES = [
  "raw_items",
  "clusters",
  "items",
  "newsletters",
  "api_tokens",
  "saved_collections",
  "feedback",
  "cluster_splits",
  "column_qc_log",
  "llm_usage",
  "policy_versions",
  "iteration_runs",
];

function convert(value: unknown, pgType: string): InValue {
  if (value === null || value === undefined) return null;
  if (pgType === "halfvec") {
    const cells = (value as string).slice(1, -1).split(",").map(Number);
    if (cells.some((n) => !Number.isFinite(n))) {
      throw new Error("non-finite embedding cell");
    }
    return Buffer.from(new Float32Array(cells).buffer);
  }
  if (value instanceof Date) return value.getTime();
  if (typeof value === "boolean") return value ? 1 : 0;
  if (pgType === "numeric") return Number(value);
  if (Array.isArray(value) || typeof value === "object") {
    return JSON.stringify(value);
  }
  return value as InValue;
}

async function main() {
  const pg = postgres(
    process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL!,
    { prepare: false, max: 1, ssl: "require" },
  );
  const turso = createClient({
    url: process.env.TURSO_DATABASE_URL!.replace(/^libsql:/, "https:"),
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  await pg.begin("isolation level repeatable read read only", async (tx) => {
    for (const name of TABLES) {
      const maxRow = await turso.execute(
        `SELECT COALESCE(MAX(id), 0) AS m FROM ${name}`,
      );
      const maxId = Number(maxRow.rows[0].m);
      const cols = await tx<{ column_name: string; udt_name: string }[]>`
        SELECT column_name, udt_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${name}
        ORDER BY ordinal_position`;
      const colNames = cols.map((c) => c.column_name);
      const typeOf = Object.fromEntries(
        cols.map((c) => [c.column_name, c.udt_name]),
      );
      // postgres.js intermittently produced phantom-null columns deep into
      // the long bulk stream (two prior runs died on NOT NULL constraints;
      // fresh re-reads of the same rows were clean). Validate every row and
      // re-read once if corruption shows up.
      let rows = await tx.unsafe(
        `SELECT * FROM "${name}" WHERE id > ${maxId} ORDER BY id`,
      );
      const nullable = new Set(
        (
          await tx<{ column_name: string }[]>`
            SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = ${name}
              AND is_nullable = 'YES'`
        ).map((c) => c.column_name),
      );
      const corrupt = (rs: Record<string, unknown>[]) =>
        rs.some((r) =>
          colNames.some(
            (c) => !nullable.has(c) && (r[c] === null || r[c] === undefined),
          ),
        );
      if (corrupt(rows)) {
        console.log(`${name}: phantom nulls detected — re-reading page`);
        rows = await tx.unsafe(
          `SELECT * FROM "${name}" WHERE id > ${maxId} ORDER BY id`,
        );
        if (corrupt(rows)) throw new Error(`${name}: corruption persisted`);
      }
      if (rows.length === 0) {
        console.log(`${name}: no delta (max id ${maxId})`);
        continue;
      }
      const quoted = colNames.map((c) => `"${c}"`).join(", ");
      const insertSql = `INSERT INTO ${name} (${quoted}) VALUES (${colNames.map(() => "?").join(", ")})`;
      for (let i = 0; i < rows.length; i += 100) {
        const slice = rows.slice(i, i + 100);
        const stmts = slice.map((row: Record<string, unknown>) => ({
          sql: insertSql,
          args: colNames.map((c) => convert(row[c], typeOf[c])),
        }));
        try {
          await turso.batch(stmts, "write");
        } catch (err) {
          // Batch path intermittently fails with phantom NOT NULL violations
          // (suspected client/runtime serialization bug on large batches).
          // Fall back to per-row inserts, which pinpoints any genuinely bad
          // row and sidesteps batch serialization.
          console.log(
            `${name}: batch @${i} failed (${err instanceof Error ? err.message.slice(0, 60) : err}) — retrying row-by-row`,
          );
          for (let j = 0; j < slice.length; j++) {
            try {
              await turso.execute({ sql: insertSql, args: stmts[j].args });
            } catch (rowErr) {
              console.error(
                `${name}: row id=${slice[j].id} failed:`,
                JSON.stringify(
                  Object.fromEntries(
                    colNames.map((c, k) => [
                      c,
                      stmts[j].args[k] === null
                        ? null
                        : String(stmts[j].args[k]).slice(0, 40),
                    ]),
                  ),
                ),
              );
              throw rowErr;
            }
          }
        }
        if ((i + 100) % 5000 < 100) console.log(`  … ${i + slice.length}/${rows.length}`);
      }
      console.log(`${name}: +${rows.length} delta rows (after id ${maxId})`);
    }
  });
  await pg.end({ timeout: 3 });
  turso.close();
  console.log("DELTA DONE");
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
