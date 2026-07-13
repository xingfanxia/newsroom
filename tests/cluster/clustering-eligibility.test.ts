/**
 * Behavioral test for the clustering opt-out predicate (W5.2).
 *
 * Runs the REAL `notClusteringOptedOut` SQL fragment inside a drizzle query
 * against a fresh file-backed libSQL DB, so the correlated NOT EXISTS is
 * exercised against actual SQLite — not just asserted as source text. Digest
 * sources (clustering_opt_out = 1) must be filtered out of every Stage A / A.5
 * candidate + neighbor query; everything else (including sourceless rows) stays.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { integer, sqliteTable } from "drizzle-orm/sqlite-core";
import { asc } from "drizzle-orm";
import { notClusteringOptedOut } from "@/workers/cluster/clustering-eligibility";

// Minimal inline tables matching the columns the predicate touches. The table
// name MUST be "items"/"sources" so the alias the helper emits resolves.
const items = sqliteTable("items", {
  id: integer("id").primaryKey(),
  sourceId: integer("source_id"),
});
const sources = sqliteTable("sources", {
  id: integer("id").primaryKey(),
  clusteringOptOut: integer("clustering_opt_out").notNull().default(0),
});

const DDL = `
CREATE TABLE sources (
  id INTEGER PRIMARY KEY,
  clustering_opt_out INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE items (
  id INTEGER PRIMARY KEY,
  source_id INTEGER
);
`;

let client: Client;
let tdb: ReturnType<typeof drizzle>;
let dbPath: string;

beforeEach(async () => {
  dbPath = join(tmpdir(), `newsroom-eligibility-${crypto.randomUUID()}.db`);
  client = createClient({ url: `file:${dbPath}` });
  tdb = drizzle(client, { casing: "snake_case" });
  await client.executeMultiple(DDL);
  await client.executeMultiple(`
    INSERT INTO sources (id, clustering_opt_out) VALUES (1, 0), (2, 1);
    INSERT INTO items (id, source_id) VALUES (10, 1), (11, 2), (12, NULL);
  `);
});

afterEach(() => {
  client.close();
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(`${dbPath}${suffix}`, { force: true });
  }
});

describe("notClusteringOptedOut (W5.2)", () => {
  it("excludes items from opted-out sources, keeps everything else", async () => {
    const rows = await tdb
      .select({ id: items.id })
      .from(items)
      .where(notClusteringOptedOut("items"))
      .orderBy(asc(items.id));

    const ids = rows.map((r) => r.id);
    // item 11 (source 2, opted out) is dropped; item 10 (normal) and item 12
    // (no source → NOT EXISTS is vacuously true) stay eligible.
    expect(ids).toEqual([10, 12]);
  });

  it("keeps all items once the opt-out flag is cleared", async () => {
    await client.execute(`UPDATE sources SET clustering_opt_out = 0`);

    const rows = await tdb
      .select({ id: items.id })
      .from(items)
      .where(notClusteringOptedOut("items"))
      .orderBy(asc(items.id));

    expect(rows.map((r) => r.id)).toEqual([10, 11, 12]);
  });
});
