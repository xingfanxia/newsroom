/* Integrity verification pg vs Turso v2 (one-off, removed after cutover). */
import postgres from "postgres";
import { createClient } from "@libsql/client";

const pg = postgres(
  process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL!,
  { prepare: false, max: 1, ssl: "require" },
);
const turso = createClient({
  url: process.env.TURSO_DATABASE_URL!.replace(/^libsql:/, "https:"),
  authToken: process.env.TURSO_AUTH_TOKEN,
});

let failures = 0;
async function compare(label: string, pgSql: string, tSql: string) {
  const [pgRow] = await pg.unsafe(pgSql);
  const tRow = (await turso.execute(tSql)).rows[0] as Record<string, unknown>;
  const keys = Object.keys(pgRow);
  for (const k of keys) {
    const a = Number(pgRow[k]);
    const b = Number(tRow[k]);
    const ok = Math.abs(a - b) < 1e-6;
    if (!ok) failures++;
    console.log(`${label}.${k}: pg=${a} turso=${b} ${ok ? "✓" : "✗✗"}`);
  }
}

// Checksums bounded to the v2 snapshot (pg is live; ignore tail drift)
const maxIds: Record<string, number> = {};
for (const t of ["raw_items", "clusters", "items", "cluster_splits", "llm_usage"]) {
  maxIds[t] = Number((await turso.execute(`SELECT MAX(id) AS m FROM ${t}`)).rows[0].m);
}

await compare(
  "raw_items",
  `SELECT count(*)::int AS n, sum(id)::bigint AS sid, sum(length(external_id))::bigint AS sext, count(*) FILTER (WHERE title IS NOT NULL)::int AS nt FROM raw_items WHERE id <= ${maxIds.raw_items}`,
  `SELECT count(*) AS n, sum(id) AS sid, sum(length(external_id)) AS sext, count(CASE WHEN title IS NOT NULL THEN 1 END) AS nt FROM raw_items WHERE id <= ${maxIds.raw_items}`,
);
await compare(
  "clusters",
  `SELECT count(*)::int AS n, sum(id)::bigint AS sid, sum(lead_item_id)::bigint AS slead, sum(member_count)::bigint AS smc, count(canonical_title_zh)::int AS nzh FROM clusters WHERE id <= ${maxIds.clusters}`,
  `SELECT count(*) AS n, sum(id) AS sid, sum(lead_item_id) AS slead, sum(member_count) AS smc, count(canonical_title_zh) AS nzh FROM clusters WHERE id <= ${maxIds.clusters}`,
);
await compare(
  "items",
  `SELECT count(*)::int AS n, sum(id)::bigint AS sid, sum(raw_item_id)::bigint AS sraw, sum(length(title))::bigint AS st, count(embedding)::int AS nemb, count(cluster_id)::int AS ncl, sum(coalesce(importance,0))::bigint AS simp FROM items WHERE id <= ${maxIds.items}`,
  `SELECT count(*) AS n, sum(id) AS sid, sum(raw_item_id) AS sraw, sum(length(title)) AS st, count(embedding) AS nemb, count(cluster_id) AS ncl, sum(coalesce(importance,0)) AS simp FROM items WHERE id <= ${maxIds.items}`,
);
await compare(
  "cluster_splits",
  `SELECT count(*)::int AS n, sum(id)::bigint AS sid, sum(item_id)::bigint AS sitem FROM cluster_splits WHERE id <= ${maxIds.cluster_splits}`,
  `SELECT count(*) AS n, sum(id) AS sid, sum(item_id) AS sitem FROM cluster_splits WHERE id <= ${maxIds.cluster_splits}`,
);
await compare(
  "llm_usage",
  `SELECT count(*)::int AS n, sum(id)::bigint AS sid, sum(input_tokens)::bigint AS sin, sum(output_tokens)::bigint AS sout FROM llm_usage WHERE id <= ${maxIds.llm_usage}`,
  `SELECT count(*) AS n, sum(id) AS sid, sum(input_tokens) AS sin, sum(output_tokens) AS sout FROM llm_usage WHERE id <= ${maxIds.llm_usage}`,
);

// Random full-row spot checks on items (30 rows): every scalar column + embedding head
const sample = await pg.unsafe(
  `SELECT * FROM items WHERE id <= ${maxIds.items} ORDER BY random() LIMIT 30`,
);
let rowFail = 0;
for (const p of sample) {
  const t = (
    await turso.execute({ sql: "SELECT * FROM items WHERE id = ?", args: [p.id] })
  ).rows[0] as Record<string, unknown>;
  if (!t) { console.log(`row ${p.id}: MISSING in turso ✗✗`); rowFail++; failures++; continue; }
  for (const [k, v] of Object.entries(p)) {
    let pv: unknown = v;
    let tv: unknown = t[k];
    if (v instanceof Date) pv = v.getTime();
    if (k === "embedding" && v != null) {
      pv = String(v).slice(0, 50);
      const buf = tv as ArrayBuffer;
      const arr = new Float32Array(buf instanceof ArrayBuffer ? buf : new Uint8Array(buf as never).buffer);
      tv = `[${Array.from(arr.slice(0, 3)).map((x) => +x.toFixed(6)).join(",")}`;
      const pgHead = String(v).slice(1).split(",").slice(0, 3).map(Number);
      const tHead = Array.from(arr.slice(0, 3));
      const close = pgHead.every((x, i) => Math.abs(x - tHead[i]) < 1e-4);
      if (!close) { console.log(`row ${p.id}.embedding: pg=${pgHead} turso=${tHead} ✗✗`); rowFail++; failures++; }
      continue;
    }
    if (typeof v === "boolean") pv = v ? 1 : 0;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) pv = JSON.stringify(v);
    if (pv === null && tv === null) continue;
    if (String(pv) !== String(tv)) {
      console.log(`row ${p.id}.${k}: pg=${String(pv).slice(0, 60)} turso=${String(tv).slice(0, 60)} ✗✗`);
      rowFail++; failures++;
    }
  }
}
console.log(`spot check: 30 random items rows, ${rowFail === 0 ? "all fields match ✓" : rowFail + " mismatches ✗✗"}`);
console.log(failures === 0 ? "VERIFY PASS" : `VERIFY FAIL (${failures})`);
await pg.end({ timeout: 3 });
turso.close();
process.exit(failures === 0 ? 0 : 1);
