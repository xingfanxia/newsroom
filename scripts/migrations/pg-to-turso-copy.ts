/* One-off data copy: Supabase Postgres → Turso libSQL (newsroom, 2026-07-11).
 *
 * Run FROM the newsroom repo root (needs its node_modules) while the
 * `postgres` package is still installed:
 *   bun --env-file=.env.local scripts/migrations/pg-to-turso-copy.ts
 * Delete this file after the copy — it must NOT survive into the repo
 * (imports `postgres`, which the Turso migration removes).
 *
 * All Postgres reads run inside ONE `REPEATABLE READ READ ONLY` transaction:
 * the source is a LIVE database (crons mutate clusters/items every ~15 min),
 * and page-by-page reads outside a snapshot see torn state. Keyset paging on
 * integer-PK tables for the same reason (OFFSET pages shift under deletes).
 *
 * Schema must already exist on Turso. Conversions (pg type → sqlite storage):
 *   timestamptz  → integer ms epoch      (drizzle integer timestamp_ms mode)
 *   boolean      → 0/1
 *   jsonb        → JSON text
 *   text[]       → JSON text
 *   numeric      → float (real)
 *   halfvec      → raw F32 little-endian blob (valid F32_BLOB literal)
 */
import postgres from "postgres";
import { createClient, type InValue } from "@libsql/client";

// FK dependency order — parents before children. intPk = keyset paging.
const TABLES: Array<{ name: string; batch: number; intPk: boolean }> = [
  { name: "sources", batch: 500, intPk: false },
  { name: "users", batch: 500, intPk: false },
  { name: "source_health", batch: 500, intPk: false },
  { name: "raw_items", batch: 100, intPk: true }, // jsonb payloads ~5KB avg
  { name: "clusters", batch: 300, intPk: true },
  { name: "items", batch: 50, intPk: true }, // body_md + 12KB embedding
  { name: "newsletters", batch: 20, intPk: true }, // long-form text columns
  { name: "api_tokens", batch: 500, intPk: true },
  { name: "saved_collections", batch: 500, intPk: true },
  { name: "feedback", batch: 500, intPk: true },
  { name: "cluster_splits", batch: 1000, intPk: true },
  { name: "column_qc_log", batch: 200, intPk: true },
  { name: "llm_usage", batch: 1000, intPk: true },
  { name: "policy_versions", batch: 50, intPk: true },
  { name: "iteration_runs", batch: 50, intPk: true },
];

function convert(value: unknown, pgType: string): InValue {
  if (value === null || value === undefined) return null;
  if (pgType === "halfvec") {
    // postgres.js hands halfvec back as '[0.1,0.2,...]' text.
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
  const pgUrl =
    process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL;
  if (!pgUrl || !process.env.TURSO_DATABASE_URL) {
    throw new Error("need POSTGRES_URL(_NON_POOLING) + TURSO_DATABASE_URL");
  }
  const pg = postgres(pgUrl, { prepare: false, max: 1, ssl: "require" });
  const turso = createClient({
    url: process.env.TURSO_DATABASE_URL.replace(/^libsql:/, "https:"),
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  await pg.begin("isolation level repeatable read read only", async (tx) => {
    for (const { name, batch, intPk } of TABLES) {
      // Column → pg type map drives conversion (halfvec/numeric aren't
      // distinguishable from the JS value alone).
      const cols = await tx<{ column_name: string; udt_name: string }[]>`
        SELECT column_name, udt_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${name}
        ORDER BY ordinal_position`;
      const colNames = cols.map((c) => c.column_name);
      const typeOf = Object.fromEntries(
        cols.map((c) => [c.column_name, c.udt_name]),
      );
      const [{ count: total }] = await tx.unsafe(
        `SELECT COUNT(*)::int AS count FROM "${name}"`,
      );
      console.log(`${name}: ${total} rows (${colNames.length} cols)`);

      const quotedCols = colNames.map((c) => `"${c}"`).join(", ");
      const insertSql = `INSERT INTO ${name} (${quotedCols}) VALUES (${colNames.map(() => "?").join(", ")})`;
      let copied = 0;
      let lastId = -2147483648;
      let offset = 0;
      for (;;) {
        const rows = intPk
          ? await tx.unsafe(
              `SELECT * FROM "${name}" WHERE id > ${lastId} ORDER BY id LIMIT ${batch}`,
            )
          : await tx.unsafe(
              `SELECT * FROM "${name}" ORDER BY 1 LIMIT ${batch} OFFSET ${offset}`,
            );
        if (rows.length === 0) break;
        await turso.batch(
          rows.map((row: Record<string, unknown>) => ({
            sql: insertSql,
            args: colNames.map((c) => convert(row[c], typeOf[c])),
          })),
          "write",
        );
        copied += rows.length;
        if (intPk) lastId = Number(rows[rows.length - 1].id);
        else offset += rows.length;
        if (copied % 5000 < batch) console.log(`  … ${copied}/${total}`);
      }

      const check = await turso.execute(
        `SELECT COUNT(*) AS count FROM ${name}`,
      );
      const tursoCount = Number(check.rows[0].count);
      console.log(
        `  → turso: ${tursoCount} ${tursoCount === Number(total) ? "✓" : "✗ MISMATCH"}`,
      );
      if (tursoCount !== Number(total)) {
        throw new Error(`count mismatch on ${name}`);
      }
    }
  });

  // Spot checks: embedding round-trip + timestamp sanity.
  const sample = await turso.execute(
    `SELECT id, length(embedding) AS emb_bytes,
            vector_extract(embedding) AS emb_text,
            published_at, title
     FROM items WHERE embedding IS NOT NULL LIMIT 1`,
  );
  const r = sample.rows[0] as Record<string, unknown>;
  console.log("sample item:", {
    id: r.id,
    emb_bytes: r.emb_bytes, // expect 12288 (3072 × 4)
    emb_head: String(r.emb_text).slice(0, 60),
    published_at_ms: r.published_at,
    published_iso: new Date(Number(r.published_at)).toISOString(),
    title: String(r.title).slice(0, 60),
  });
  await pg.end({ timeout: 3 });
  turso.close();
  console.log("DONE");
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
