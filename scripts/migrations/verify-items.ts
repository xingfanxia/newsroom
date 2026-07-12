/* Chunked items + tail-table verification pg vs Turso v2 (one-off). */
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

const maxId = Number((await turso.execute("SELECT MAX(id) AS m FROM items")).rows[0].m);
const CHUNK = 4000;
let agg = { n: 0, sid: 0, sraw: 0, st: 0, nemb: 0, ncl: 0, simp: 0 };
let pgg = { n: 0, sid: 0, sraw: 0, st: 0, nemb: 0, ncl: 0, simp: 0 };
for (let lo = 0; lo <= maxId; lo += CHUNK) {
  const hi = lo + CHUNK;
  const t = (
    await turso.execute(
      `SELECT count(*) AS n, coalesce(sum(id),0) AS sid, coalesce(sum(raw_item_id),0) AS sraw,
              coalesce(sum(length(title)),0) AS st,
              count(CASE WHEN embedding IS NOT NULL THEN 1 END) AS nemb,
              count(cluster_id) AS ncl, coalesce(sum(coalesce(importance,0)),0) AS simp
       FROM items WHERE id > ${lo} AND id <= ${hi}`,
    )
  ).rows[0] as Record<string, unknown>;
  const [p] = await pg.unsafe(
    `SELECT count(*)::int AS n, coalesce(sum(id),0)::bigint AS sid, coalesce(sum(raw_item_id),0)::bigint AS sraw,
            coalesce(sum(length(title)),0)::bigint AS st,
            count(embedding)::int AS nemb, count(cluster_id)::int AS ncl,
            coalesce(sum(coalesce(importance,0)),0)::bigint AS simp
     FROM items WHERE id > ${lo} AND id <= ${hi}`,
  );
  for (const k of Object.keys(agg)) {
    (agg as Record<string, number>)[k] += Number(t[k]);
    (pgg as Record<string, number>)[k] += Number(p[k]);
  }
}
for (const k of Object.keys(agg)) {
  const a = (pgg as Record<string, number>)[k];
  const b = (agg as Record<string, number>)[k];
  const ok = a === b;
  if (!ok) failures++;
  console.log(`items.${k}: pg=${a} turso=${b} ${ok ? "✓" : "✗✗ (check mutability)"}`);
}

// Spot-check 30 random rows fully
const sample = await pg.unsafe(
  `SELECT * FROM items WHERE id <= ${maxId} ORDER BY random() LIMIT 30`,
);
let rowFail = 0;
for (const p of sample) {
  const t = (
    await turso.execute({ sql: "SELECT * FROM items WHERE id = ?", args: [p.id] })
  ).rows[0] as Record<string, unknown> | undefined;
  if (!t) { console.log(`row ${p.id}: MISSING ✗✗`); rowFail++; failures++; continue; }
  for (const [k, v] of Object.entries(p)) {
    let pv: unknown = v;
    const tv: unknown = t[k];
    if (k === "embedding") {
      if (v == null) { if (tv != null) { rowFail++; failures++; console.log(`row ${p.id}.embedding: pg null, turso not ✗✗`); } continue; }
      const buf = tv as ArrayBuffer;
      const arr = new Float32Array(buf instanceof ArrayBuffer ? buf : Buffer.from(buf as never).buffer);
      const pgHead = String(v).slice(1).split(",").slice(0, 3).map(Number);
      const tHead = Array.from(arr.slice(0, 3));
      if (!pgHead.every((x, i) => Math.abs(x - tHead[i]) < 1e-4)) {
        console.log(`row ${p.id}.embedding: pg=${pgHead} turso=${tHead} ✗✗`); rowFail++; failures++;
      }
      continue;
    }
    if (v instanceof Date) pv = v.getTime();
    if (typeof v === "boolean") pv = v ? 1 : 0;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) pv = JSON.stringify(v);
    if (pv === null && tv === null) continue;
    if (String(pv) !== String(tv)) {
      console.log(`row ${p.id}.${k}: pg=${String(pv).slice(0, 50)} turso=${String(tv).slice(0, 50)} ✗✗`);
      rowFail++; failures++;
    }
  }
}
console.log(`spot check: ${rowFail === 0 ? "30/30 rows match ✓" : rowFail + " field mismatches"}`);

// Tail tables (cheap)
for (const [t, cols] of [
  ["llm_usage", "count(*) AS n, coalesce(sum(id),0) AS sid, coalesce(sum(input_tokens),0) AS sin"],
  ["cluster_splits", "count(*) AS n, coalesce(sum(id),0) AS sid, coalesce(sum(item_id),0) AS sitem"],
  ["newsletters", "count(*) AS n, coalesce(sum(id),0) AS sid, coalesce(sum(story_count),0) AS ssc"],
] as const) {
  const m = Number((await turso.execute(`SELECT MAX(id) AS m FROM ${t}`)).rows[0].m);
  const tr = (await turso.execute(`SELECT ${cols} FROM ${t} WHERE id <= ${m}`)).rows[0] as Record<string, unknown>;
  const [pr] = await pg.unsafe(`SELECT ${cols.replace(/coalesce\(sum\(([a-z_]+)\),0\)/g, "coalesce(sum($1),0)::bigint").replace("count(*)", "count(*)::int")} FROM ${t} WHERE id <= ${m}`);
  for (const k of Object.keys(pr)) {
    const ok = Number(pr[k]) === Number(tr[k]);
    if (!ok) failures++;
    console.log(`${t}.${k}: pg=${pr[k]} turso=${tr[k]} ${ok ? "✓" : "✗✗"}`);
  }
}
console.log(failures === 0 ? "VERIFY PASS" : `VERIFY FAIL (${failures})`);
await pg.end({ timeout: 3 });
turso.close();
process.exit(failures === 0 ? 0 : 1);
