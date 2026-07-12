/* Find + re-insert items rows present in pg but missing in Turso (one-off). */
import postgres from "postgres";
import { createClient, type InValue } from "@libsql/client";

const pg = postgres(process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL!, { prepare: false, max: 1, ssl: "require" });
const turso = createClient({ url: process.env.TURSO_DATABASE_URL!.replace(/^libsql:/, "https:"), authToken: process.env.TURSO_AUTH_TOKEN });

function convert(value: unknown, pgType: string): InValue {
  if (value === null || value === undefined) return null;
  if (pgType === "halfvec") {
    const cells = (value as string).slice(1, -1).split(",").map(Number);
    return Buffer.from(new Float32Array(cells).buffer);
  }
  if (value instanceof Date) return value.getTime();
  if (typeof value === "boolean") return value ? 1 : 0;
  if (pgType === "numeric") return Number(value);
  if (Array.isArray(value) || typeof value === "object") return JSON.stringify(value);
  return value as InValue;
}

const maxId = Number((await turso.execute("SELECT MAX(id) AS m FROM items")).rows[0].m);
const tursoIds = new Set<number>();
for (let lo = 0; lo <= maxId; lo += 20000) {
  const r = await turso.execute(`SELECT id FROM items WHERE id > ${lo} AND id <= ${lo + 20000}`);
  for (const row of r.rows) tursoIds.add(Number(row.id));
}
const pgIds = (await pg.unsafe(`SELECT id FROM items WHERE id <= ${maxId} ORDER BY id`)).map((r: { id: number }) => Number(r.id));
const missing = pgIds.filter((id) => !tursoIds.has(id));
console.log(`turso ids: ${tursoIds.size}, pg ids in range: ${pgIds.length}, missing: ${missing.length}`);
console.log("missing ids:", missing.join(","));

if (missing.length > 0) {
  const cols = await pg<{ column_name: string; udt_name: string }[]>`
    SELECT column_name, udt_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'items' ORDER BY ordinal_position`;
  const colNames = cols.map((c) => c.column_name);
  const typeOf = Object.fromEntries(cols.map((c) => [c.column_name, c.udt_name]));
  const insertSql = `INSERT INTO items (${colNames.map((c) => `"${c}"`).join(", ")}) VALUES (${colNames.map(() => "?").join(", ")})`;
  const rows = await pg.unsafe(`SELECT * FROM items WHERE id IN (${missing.join(",")})`);
  for (const row of rows) {
    await turso.execute({ sql: insertSql, args: colNames.map((c) => convert(row[c], typeOf[c])) });
  }
  console.log(`re-inserted ${rows.length} rows`);
  const check = await turso.execute(`SELECT COUNT(*) AS n FROM items WHERE id <= ${maxId}`);
  console.log("turso count now:", Number(check.rows[0].n), "expected:", pgIds.length);
}
await pg.end({ timeout: 3 });
turso.close();
