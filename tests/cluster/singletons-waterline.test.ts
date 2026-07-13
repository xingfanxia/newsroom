/**
 * Behavioral tests for the A.5 singleton-recheck WATERLINE (FIX-W7 / A2).
 *
 * The read-budget dominant cost was A.5 re-scanning the same persistent
 * singletons every tick (~144×/72h). The waterline adds an
 * `items.last_recheck_at` cooldown: a singleton rechecked within
 * SINGLETON_RECHECK_COOLDOWN_HOURS is skipped, and the candidate ordering is
 * recheck-stalest-first (never published-ASC) so no singleton is starved.
 * The candidate window is (neighbor-window + cooldown), so a kept singleton
 * stays selectable ≥1 cooldown past the latest possible neighbor arrival ⇒ no
 * in-window neighbor is missed, just merged ≤cooldown hours later — with ~20×
 * fewer neighbor scans.
 *
 * Runs the REAL query/loop against a fresh file-backed libSQL DB (F32_BLOB
 * embeddings, real vector_distance_cos) through the injected-client seam.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "@/db/schema";
import { embeddingToDriver } from "@/db/schema";
import {
  runSingletonReclusterBatch,
  selectSingletonReclusterCandidates,
  resolveSingletonCooldownMs,
  SINGLETON_RECHECK_COOLDOWN_HOURS,
  SINGLETON_RECLUSTER_WINDOW_HOURS,
  SINGLETON_RECLUSTER_CANDIDATE_RECENCY_HOURS,
} from "@/workers/cluster/singletons";

type Tdb = ReturnType<typeof drizzle<typeof schema>>;

const DDL = `
CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  clustering_opt_out INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE clusters (
  id INTEGER PRIMARY KEY,
  member_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE items (
  id INTEGER PRIMARY KEY,
  source_id TEXT NOT NULL DEFAULT 's1',
  title TEXT NOT NULL DEFAULT '',
  title_zh TEXT,
  published_at INTEGER NOT NULL DEFAULT 0,
  cluster_id INTEGER,
  cluster_verified_at INTEGER,
  clustered_at INTEGER,
  last_recheck_at INTEGER,
  enriched_at INTEGER,
  tier TEXT,
  embedding F32_BLOB(3)
);
CREATE TABLE cluster_splits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,
  from_cluster_id INTEGER NOT NULL
);
`;

const HOUR = 3_600_000;
const NOW = 10_000_000_000_000; // fixed clock for deterministic cooldown math

let client: Client;
let tdb: Tdb;
let dbPath: string;

beforeEach(async () => {
  dbPath = join(tmpdir(), `newsroom-waterline-test-${crypto.randomUUID()}.db`);
  client = createClient({ url: `file:${dbPath}` });
  tdb = drizzle(client, { schema, casing: "snake_case" });
  await client.executeMultiple(DDL);
  await client.execute({
    sql: `INSERT INTO sources (id, clustering_opt_out) VALUES ('s1', 0)`,
    args: [],
  });
});

afterEach(() => {
  client.close();
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(`${dbPath}${suffix}`, { force: true });
  }
});

/** Seed a singleton: a member_count=1 cluster + its lone enriched item. */
async function seedSingleton(o: {
  itemId: number;
  clusterId: number;
  lastRecheckAt: number | null;
  publishedAt?: number;
  vec?: number[];
}) {
  await client.execute({
    sql: `INSERT INTO clusters (id, member_count) VALUES (?, 1)`,
    args: [o.clusterId],
  });
  await client.execute({
    sql: `INSERT INTO items
            (id, source_id, published_at, cluster_id, cluster_verified_at,
             clustered_at, last_recheck_at, enriched_at, tier, embedding)
          VALUES (?, 's1', ?, ?, NULL, ?, ?, ?, 'all', ?)`,
    args: [
      o.itemId,
      o.publishedAt ?? NOW - HOUR,
      o.clusterId,
      o.publishedAt ?? NOW - HOUR,
      o.lastRecheckAt,
      o.publishedAt ?? NOW - HOUR,
      embeddingToDriver(o.vec ?? [1, 0, 0]),
    ],
  });
}

async function candidateIds(opts: {
  cooldownHours?: number | null;
  maxPerRun?: number | null;
}): Promise<number[]> {
  const rows = await selectSingletonReclusterCandidates(
    { recencyHours: 72, now: NOW, ...opts },
    tdb,
  );
  return rows.map((r) => r.item_id);
}

async function lastRecheckOf(id: number): Promise<number | null> {
  const r = await client.execute({
    sql: `SELECT last_recheck_at FROM items WHERE id = ?`,
    args: [id],
  });
  const v = r.rows[0]?.last_recheck_at;
  return v == null ? null : Number(v);
}

describe("A.5 recheck waterline — cooldown filter", () => {
  it("excludes a singleton rechecked within the cooldown window", async () => {
    await seedSingleton({ itemId: 1, clusterId: 1, lastRecheckAt: NOW - HOUR });
    expect(await candidateIds({ cooldownHours: 12 })).toEqual([]);
  });

  it("includes a singleton whose recheck is older than the cooldown", async () => {
    await seedSingleton({
      itemId: 2,
      clusterId: 2,
      lastRecheckAt: NOW - 13 * HOUR,
    });
    expect(await candidateIds({ cooldownHours: 12 })).toEqual([2]);
  });

  it("includes a never-rechecked singleton (last_recheck_at NULL)", async () => {
    await seedSingleton({ itemId: 3, clusterId: 3, lastRecheckAt: null });
    expect(await candidateIds({ cooldownHours: 12 })).toEqual([3]);
  });

  it("cooldownHours=null disables the waterline (manual backfill)", async () => {
    await seedSingleton({ itemId: 4, clusterId: 4, lastRecheckAt: NOW - HOUR });
    expect(await candidateIds({ cooldownHours: null })).toEqual([4]);
  });
});

describe("A.5 recheck waterline — anti-starvation ordering", () => {
  it("returns never-rechecked first, then stalest-rechecked (not published-ASC)", async () => {
    // A never-checked but freshest published; B/C checked long ago. The OLD
    // published-ASC ordering would starve A (newest) behind older items; the
    // recheck ordering must surface A (NULL) then the stalest recheck (B).
    await seedSingleton({
      itemId: 30,
      clusterId: 30,
      lastRecheckAt: null,
      publishedAt: NOW - HOUR,
    });
    await seedSingleton({
      itemId: 31,
      clusterId: 31,
      lastRecheckAt: NOW - 14 * HOUR,
      publishedAt: NOW - 5 * HOUR,
    });
    await seedSingleton({
      itemId: 32,
      clusterId: 32,
      lastRecheckAt: NOW - 13 * HOUR,
      publishedAt: NOW - 4 * HOUR,
    });
    expect(await candidateIds({ cooldownHours: 12, maxPerRun: 2 })).toEqual([
      30, 31,
    ]);
  });
});

describe("A.5 recheck waterline — stamp + skip loop", () => {
  it("stamps last_recheck_at after a kept singleton, then skips it next run", async () => {
    // A lone singleton with no other clustered neighbor → decision "keep".
    await seedSingleton({
      itemId: 50,
      clusterId: 50,
      lastRecheckAt: null,
      publishedAt: Date.now() - HOUR,
    });

    const first = await runSingletonReclusterBatch({
      recencyHours: 72,
      client: tdb,
    });
    expect(first.processed).toBe(1);
    expect(first.kept).toBe(1);
    expect(await lastRecheckOf(50)).not.toBeNull(); // stamped ~now

    // Immediately re-run: the just-stamped singleton is within cooldown → skipped.
    const second = await runSingletonReclusterBatch({
      recencyHours: 72,
      client: tdb,
    });
    expect(second.processed).toBe(0);
  });

  it("dry-run does NOT stamp last_recheck_at", async () => {
    await seedSingleton({
      itemId: 51,
      clusterId: 51,
      lastRecheckAt: null,
      publishedAt: Date.now() - HOUR,
    });
    await runSingletonReclusterBatch({
      recencyHours: 72,
      client: tdb,
      dryRun: true,
    });
    expect(await lastRecheckOf(51)).toBeNull();
  });
});

describe("A.5 recheck waterline — recall guarantee (candidate window)", () => {
  // The recall guarantee: a kept singleton must stay a *candidate* for ≥1
  // cooldown past the latest possible neighbor arrival, or a neighbor landing in
  // its final cooldown hours could be missed forever (A.5 is the sole late-merge
  // path; published_at only ages). That requires candidate recency ≥ neighbor
  // window + cooldown. This invariant test trips if a future edit shrinks it.
  it("candidate recency ≥ neighbor window + cooldown", () => {
    expect(SINGLETON_RECHECK_COOLDOWN_HOURS).toBeGreaterThan(0);
    expect(SINGLETON_RECLUSTER_CANDIDATE_RECENCY_HOURS).toBeGreaterThanOrEqual(
      SINGLETON_RECLUSTER_WINDOW_HOURS + SINGLETON_RECHECK_COOLDOWN_HOURS,
    );
  });

  it("keeps a singleton older than the neighbor window selectable (late-neighbor recall)", async () => {
    // Published 80h ago: PAST the 72h neighbor window but still inside the
    // 84h candidate recency. It must remain a candidate so a neighbor arriving
    // in its final hours can still be caught before it ages out.
    await seedSingleton({
      itemId: 60,
      clusterId: 60,
      lastRecheckAt: null,
      publishedAt: NOW - 80 * HOUR,
    });
    const rows = await selectSingletonReclusterCandidates(
      {
        recencyHours: SINGLETON_RECLUSTER_CANDIDATE_RECENCY_HOURS,
        now: NOW,
        cooldownHours: 12,
      },
      tdb,
    );
    expect(rows.map((r) => r.item_id)).toEqual([60]);
  });

  it("resolves cooldown ms; null means no cooldown", () => {
    expect(resolveSingletonCooldownMs(12)).toBe(12 * HOUR);
    expect(resolveSingletonCooldownMs(undefined)).toBe(
      SINGLETON_RECHECK_COOLDOWN_HOURS * HOUR,
    );
    expect(resolveSingletonCooldownMs(null)).toBeNull();
  });
});
