/**
 * Full logical backup of the live Turso DB → gzipped JSONL, one file per
 * table, under a git-ignored `backups/<UTC-timestamp>/` dir.
 *
 * WHY THIS EXISTS: after the Supabase→Turso migration the Turso DB is the
 * ONLY copy of the data — Supabase is deleted, the Turso Starter plan has no
 * PITR, and there was zero dump automation. One bad `drizzle-kit push` (now
 * neutered) or an accidental drop would be unrecoverable. This is the safety
 * net. Run it before any risky prod-data mutation.
 *
 * Blob columns (items.embedding F32_BLOB, items.embedding_small, any JSON-as-
 * blob) are captured faithfully as {"$blob":"<base64>"} so the dump is a
 * lossless copy of the vectors — the single most expensive-to-regenerate data
 * in the system. Timestamps are integer ms (raw wire values, no Date coercion,
 * because we read through the raw libSQL client not drizzle).
 *
 * Parity: after streaming each table, the written line count is compared to a
 * fresh COUNT(*). Any mismatch fails the whole run (exit 1) — a backup that
 * silently dropped rows is worse than no backup.
 *
 * Storage: writes locally to ./backups (gitignored). No R2/S3 creds are
 * present in .env.local today, so off-box shipping + scheduling (GitHub Action
 * / launchd nightly → R2) is a documented follow-up in
 * docs/ops/db-backup-restore.md. Restore procedure lives there too.
 *
 * Run: bun --env-file=.env.local scripts/ops/db-dump.ts [--out ./backups]
 */
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { PassThrough } from "node:stream";
import path from "node:path";
import { libsqlClient, closeDb } from "@/db/client";

const outArg = process.argv.indexOf("--out");
const OUT_ROOT = outArg >= 0 ? process.argv[outArg + 1] : "./backups";
// UTC timestamp compacted to a filesystem-safe dir name (Date.now is fine in a
// script — this isn't a resumable workflow).
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");

/** Convert one libSQL row value into a JSON-safe representation.
 *  ArrayBuffer/typed-array blobs → {$blob: base64}; bigint → {$bigint: str}. */
function encodeValue(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof ArrayBuffer) {
    return { $blob: Buffer.from(new Uint8Array(v)).toString("base64") };
  }
  if (ArrayBuffer.isView(v)) {
    const view = v as ArrayBufferView;
    return {
      $blob: Buffer.from(
        new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
      ).toString("base64"),
    };
  }
  if (typeof v === "bigint") return { $bigint: v.toString() };
  return v;
}

/** List real user tables, excluding SQLite/libSQL internals and index shadow
 *  tables (DiskANN vector index internals aren't logical data). */
async function listTables(): Promise<string[]> {
  const client = libsqlClient();
  const res = await client.execute(`
    SELECT name FROM sqlite_master
    WHERE type='table'
      AND name NOT LIKE 'sqlite_%'
      AND name NOT LIKE 'libsql_%'
      AND name NOT LIKE '%_shadow'
    ORDER BY name
  `);
  return res.rows.map((r) => String(r.name));
}

async function countRows(table: string): Promise<number> {
  const client = libsqlClient();
  const res = await client.execute(`SELECT count(*) AS n FROM "${table}"`);
  return Number(res.rows[0].n);
}

/** Keyset-paginate a table by rowid and stream JSONL into `sink`. Returns the
 *  number of rows written. Fat tables (items) use a small page; skinny tables
 *  a large one. Memory stays bounded to one page. */
async function dumpTable(table: string, sink: PassThrough): Promise<number> {
  const client = libsqlClient();
  // items rows carry ~12KB embedding blobs → keep the page small.
  const pageSize = table === "items" ? 500 : 5000;
  let lastRowid = -1;
  let written = 0;
  for (;;) {
    const res = await client.execute({
      sql: `SELECT rowid AS __rowid, * FROM "${table}"
            WHERE rowid > ? ORDER BY rowid LIMIT ?`,
      args: [lastRowid, pageSize],
    });
    if (res.rows.length === 0) break;
    for (const row of res.rows) {
      const obj: Record<string, unknown> = {};
      for (const col of res.columns) {
        if (col === "__rowid") continue;
        obj[col] = encodeValue((row as Record<string, unknown>)[col]);
      }
      lastRowid = Number((row as Record<string, unknown>).__rowid);
      const ok = sink.write(JSON.stringify(obj) + "\n");
      written++;
      // Respect backpressure so memory can't balloon on the fat items table.
      if (!ok) await new Promise((r) => sink.once("drain", r));
    }
    if (res.rows.length < pageSize) break;
  }
  sink.end();
  return written;
}

async function main() {
  const outDir = path.join(OUT_ROOT, STAMP);
  await mkdir(outDir, { recursive: true });
  console.log(`dumping to ${outDir}`);

  const tables = await listTables();
  console.log(`tables: ${tables.join(", ")}`);

  const manifest: Record<string, { rows: number; file: string }> = {};
  let mismatches = 0;

  for (const table of tables) {
    const file = `${table}.jsonl.gz`;
    const dest = path.join(outDir, file);
    const source = new PassThrough();
    const gzip = createGzip();
    const out = createWriteStream(dest);

    // Stream: PassThrough (JSONL lines) → gzip → file. dumpTable writes into
    // `source` while pipeline drains it, so memory stays at ~one page.
    const [written] = await Promise.all([
      dumpTable(table, source),
      pipeline(source, gzip, out),
    ]);

    const actual = await countRows(table);
    const ok = written === actual;
    if (!ok) mismatches++;
    manifest[table] = { rows: written, file };
    console.log(
      `  ${ok ? "OK  " : "FAIL"} ${table.padEnd(20)} ${String(written).padStart(
        7,
      )} rows${ok ? "" : ` (live count ${actual} — PARITY MISMATCH)`}`,
    );
  }

  await writeFile(
    path.join(outDir, "manifest.json"),
    JSON.stringify(
      { createdAt: STAMP, tableCount: tables.length, tables: manifest },
      null,
      2,
    ),
  );

  await closeDb();

  if (mismatches > 0) {
    console.error(`\n${mismatches} table(s) failed row-count parity — backup is NOT trustworthy`);
    process.exit(1);
  }
  console.log(`\nDB DUMP DONE — ${tables.length} tables, all parity-checked. ${outDir}`);
}

main().catch((e) => {
  console.error("dump failed:", e);
  process.exit(1);
});
