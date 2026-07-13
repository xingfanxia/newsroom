/**
 * Behavioral tests for the tombstone re-open (workers/cluster/reopen.ts, W6a).
 *
 * Runs the REAL reopenIncoherentClusters against a fresh file-backed libSQL DB
 * with actual F32_BLOB embeddings, so the vector_distance_cos self-join and the
 * loop-safety candidate predicate are exercised end to end — no creds, no prod.
 *
 * Unit vectors make the cosine distances exact:
 *   [1,0,0] vs [1,0,0] → 0.0   (coherent, < 0.38)
 *   [1,0,0] vs [0,1,0] → 1.0   (incoherent, > 0.38)
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { embeddingToDriver } from "@/db/schema";
import {
  reopenIncoherentClusters,
  REOPEN_COHESION_DISTANCE,
} from "@/workers/cluster/reopen";

const DDL = `
CREATE TABLE clusters (
  id INTEGER PRIMARY KEY,
  lead_item_id INTEGER NOT NULL,
  member_count INTEGER NOT NULL DEFAULT 0,
  latest_member_at INTEGER,
  verified_at INTEGER,
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE items (
  id INTEGER PRIMARY KEY,
  cluster_id INTEGER,
  embedding F32_BLOB(3)
);
`;

let client: Client;
let dbPath: string;

beforeEach(async () => {
  dbPath = join(tmpdir(), `newsroom-reopen-test-${crypto.randomUUID()}.db`);
  client = createClient({ url: `file:${dbPath}` });
  await client.executeMultiple(DDL);
});

afterEach(() => {
  client.close();
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(`${dbPath}${suffix}`, { force: true });
  }
});

async function seedCluster(c: {
  id: number;
  leadItemId: number;
  memberCount: number;
  latestMemberAt: number;
  verifiedAt: number | null;
}) {
  await client.execute({
    sql: `INSERT INTO clusters
            (id, lead_item_id, member_count, latest_member_at, verified_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 0)`,
    args: [c.id, c.leadItemId, c.memberCount, c.latestMemberAt, c.verifiedAt],
  });
}

async function seedItem(id: number, clusterId: number, vec: number[]) {
  await client.execute({
    sql: `INSERT INTO items (id, cluster_id, embedding) VALUES (?, ?, ?)`,
    args: [id, clusterId, embeddingToDriver(vec)],
  });
}

async function verifiedAtOf(id: number): Promise<number | null> {
  const r = await client.execute({
    sql: `SELECT verified_at FROM clusters WHERE id = ?`,
    args: [id],
  });
  const v = r.rows[0]?.verified_at;
  return v == null ? null : Number(v);
}

describe("reopenIncoherentClusters (W6a)", () => {
  it("re-opens an incoherent cluster that grew since verification", async () => {
    // grew: latest_member_at (2000) > verified_at (1000); pair distance 1.0.
    await seedCluster({
      id: 1,
      leadItemId: 10,
      memberCount: 2,
      latestMemberAt: 2000,
      verifiedAt: 1000,
    });
    await seedItem(10, 1, [1, 0, 0]);
    await seedItem(11, 1, [0, 1, 0]);

    const rep = await reopenIncoherentClusters({
      apply: true,
      recencyHours: null,
      maxPerRun: null,
      client,
    });

    expect(rep.reopened).toBe(1);
    expect(await verifiedAtOf(1)).toBeNull(); // tombstone cleared → re-arbitrates
  });

  it("leaves a coherent grown cluster verified", async () => {
    await seedCluster({
      id: 2,
      leadItemId: 20,
      memberCount: 2,
      latestMemberAt: 2000,
      verifiedAt: 1000,
    });
    await seedItem(20, 2, [1, 0, 0]);
    await seedItem(21, 2, [1, 0, 0]); // distance 0

    const rep = await reopenIncoherentClusters({
      apply: true,
      recencyHours: null,
      maxPerRun: null,
      client,
    });

    expect(rep.reopened).toBe(0);
    expect(await verifiedAtOf(2)).toBe(1000); // untouched
  });

  it("does NOT re-open an incoherent cluster that has NOT grown (loop-safety)", async () => {
    // verified_at (3000) is AFTER latest_member_at (2000): the arbitrator
    // already re-judged this membership. Re-opening it would thrash every tick.
    await seedCluster({
      id: 3,
      leadItemId: 30,
      memberCount: 2,
      latestMemberAt: 2000,
      verifiedAt: 3000,
    });
    await seedItem(30, 3, [1, 0, 0]);
    await seedItem(31, 3, [0, 1, 0]); // incoherent, but not grown

    const rep = await reopenIncoherentClusters({
      apply: true,
      recencyHours: null,
      maxPerRun: null,
      client,
    });

    expect(rep.reopened).toBe(0);
    expect(await verifiedAtOf(3)).toBe(3000);
  });

  it("dry-run reports the count but writes nothing", async () => {
    await seedCluster({
      id: 4,
      leadItemId: 40,
      memberCount: 2,
      latestMemberAt: 2000,
      verifiedAt: 1000,
    });
    await seedItem(40, 4, [1, 0, 0]);
    await seedItem(41, 4, [0, 1, 0]);

    const rep = await reopenIncoherentClusters({
      apply: false,
      recencyHours: null,
      maxPerRun: null,
      client,
    });

    expect(rep.reopened).toBe(1); // would re-open
    expect(await verifiedAtOf(4)).toBe(1000); // but did not write
  });

  it("threshold sanity: the breach ceiling is above the Stage-A join distance", () => {
    // 0.38 must sit above the 0.25 join threshold and 0.35 cohesion gate so
    // same-event coverage is never re-opened, only genuinely stretched clusters.
    expect(REOPEN_COHESION_DISTANCE).toBeGreaterThan(0.35);
  });
});
