/**
 * Behavioral tests for the cluster data-integrity fixes (2026-07-12 audit).
 *
 * Unlike the source-contract tests elsewhere under tests/cluster (which assert
 * on the SOURCE TEXT of the functions), these run the REAL functions against a
 * fresh in-memory libSQL DB — no credentials, no network, no prod risk. The DB
 * is injected through the same seam production uses (`db()` / `libsqlClient()`
 * default when nothing is passed), so a bug in the actual SQL surfaces here.
 *
 * Covered invariants:
 *   - merge.ts split-guard: a loser item rejected from the winner is UNLINKED,
 *     not reunited; the rest MOVE; winner counts bump by the moved count only;
 *     the loser's negative edges transfer to the winner (transitive relaunder
 *     vector closed).
 *   - arbitrate.ts lead re-pick: a split that ejects the lead re-points
 *     lead_item_id to a surviving member; counts decrement by real unlinks.
 *   - reconcile.ts: orphan-item unlink, zombie age guard, aggregate recompute,
 *     dangling-lead re-point — and idempotency (second pass = 0 changes).
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import type { SourceGroup } from "@/lib/types";
import * as schema from "@/db/schema";
import { mergeClusters } from "@/workers/cluster/merge";
import { applySplitVerdict } from "@/workers/cluster/arbitrate";
import { reconcileClusters } from "@/workers/cluster/reconcile";

type Tdb = ReturnType<typeof drizzle<typeof schema>>;

// Minimal schema — only the columns the functions under test touch. Column
// names are snake_case to match drizzle's `casing: "snake_case"` mapping.
const DDL = `
CREATE TABLE clusters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_item_id INTEGER NOT NULL,
  member_count INTEGER NOT NULL DEFAULT 0,
  coverage INTEGER NOT NULL DEFAULT 0,
  first_seen_at INTEGER NOT NULL DEFAULT 0,
  latest_member_at INTEGER,
  canonical_title_zh TEXT,
  canonical_title_en TEXT,
  titled_at INTEGER,
  commentary_at INTEGER,
  importance INTEGER,
  event_tier TEXT,
  verified_at INTEGER,
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL DEFAULT '',
  published_at INTEGER NOT NULL DEFAULT 0,
  importance INTEGER,
  cluster_id INTEGER,
  clustered_at INTEGER,
  cluster_verified_at INTEGER
);
CREATE TABLE cluster_splits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,
  from_cluster_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  split_at INTEGER
);
CREATE UNIQUE INDEX cluster_splits_item_cluster_uq
  ON cluster_splits (item_id, from_cluster_id);
`;

let client: Client;
let tdb: Tdb;
let dbPath: string;

beforeEach(async () => {
  // A temp FILE (not :memory:) — libSQL opens a separate connection for each
  // interactive transaction, and per-connection :memory: DBs don't share
  // schema. A file is one DB every connection sees.
  dbPath = join(tmpdir(), `newsroom-cluster-test-${crypto.randomUUID()}.db`);
  client = createClient({ url: `file:${dbPath}` });
  tdb = drizzle(client, { schema, casing: "snake_case" });
  await client.executeMultiple(DDL);
});

afterEach(() => {
  client.close();
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(`${dbPath}${suffix}`, { force: true });
  }
});

// ── seed helpers ────────────────────────────────────────────────────────────

async function seedCluster(c: {
  id: number;
  leadItemId: number;
  memberCount: number;
  coverage: number;
  firstSeenAt?: number;
  latestMemberAt?: number | null;
  verifiedAt?: number | null;
  titledAt?: number | null;
}) {
  await client.execute({
    sql: `INSERT INTO clusters
            (id, lead_item_id, member_count, coverage, first_seen_at,
             latest_member_at, verified_at, titled_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    args: [
      c.id,
      c.leadItemId,
      c.memberCount,
      c.coverage,
      c.firstSeenAt ?? 0,
      c.latestMemberAt ?? null,
      c.verifiedAt ?? null,
      c.titledAt ?? null,
    ],
  });
}

async function seedItem(i: {
  id: number;
  clusterId: number | null;
  clusteredAt?: number | null;
  importance?: number | null;
  publishedAt?: number;
}) {
  await client.execute({
    sql: `INSERT INTO items (id, cluster_id, clustered_at, importance, published_at)
          VALUES (?, ?, ?, ?, ?)`,
    args: [
      i.id,
      i.clusterId,
      i.clusteredAt ?? null,
      i.importance ?? null,
      i.publishedAt ?? 0,
    ],
  });
}

async function seedSplit(itemId: number, fromClusterId: number) {
  await client.execute({
    sql: `INSERT INTO cluster_splits (item_id, from_cluster_id, reason, split_at)
          VALUES (?, ?, 'seed', 0)`,
    args: [itemId, fromClusterId],
  });
}

async function clusterIdOf(itemId: number): Promise<number | null> {
  const r = await client.execute({
    sql: `SELECT cluster_id FROM items WHERE id = ?`,
    args: [itemId],
  });
  const v = r.rows[0]?.cluster_id;
  return v == null ? null : Number(v);
}

async function clusterRow(id: number) {
  const r = await client.execute({
    sql: `SELECT * FROM clusters WHERE id = ?`,
    args: [id],
  });
  return r.rows[0] ?? null;
}

async function splitPairs(): Promise<Array<[number, number]>> {
  const r = await client.execute(
    `SELECT item_id, from_cluster_id FROM cluster_splits
     ORDER BY item_id, from_cluster_id`,
  );
  return r.rows.map((row) => [Number(row.item_id), Number(row.from_cluster_id)]);
}

/** MemberRow-shaped object for applySplitVerdict (its param type is private). */
function member(o: {
  itemId: number;
  importance?: number | null;
  sourceGroup?: SourceGroup;
  sourcePriority?: number;
  publishedAt?: string;
}) {
  return {
    itemId: o.itemId,
    titleZh: `zh-${o.itemId}`,
    titleEn: `en-${o.itemId}`,
    rawTitle: `raw-${o.itemId}`,
    publishedAt: o.publishedAt ?? "2026-07-01T00:00:00.000Z",
    sourceName: "TestSource",
    sourceGroup: o.sourceGroup ?? ("media" as SourceGroup),
    sourcePriority: o.sourcePriority ?? 2,
    importance: o.importance ?? 50,
  };
}

// ── merge split-guard ───────────────────────────────────────────────────────

describe("mergeClusters — split-guard + edge transfer (W1)", () => {
  it("unlinks the split-guarded loser item, moves the rest, bumps by moved count, transfers edges", async () => {
    // Winner cluster 1 (item 10). Loser cluster 2 (items 20, 21).
    await seedCluster({ id: 1, leadItemId: 10, memberCount: 1, coverage: 1 });
    await seedCluster({ id: 2, leadItemId: 20, memberCount: 2, coverage: 2 });
    await seedItem({ id: 10, clusterId: 1 });
    await seedItem({ id: 20, clusterId: 2 });
    await seedItem({ id: 21, clusterId: 2 });
    await seedItem({ id: 30, clusterId: null }); // unlinked; rejected from loser
    await seedSplit(20, 1); // item 20 was rejected from the WINNER
    await seedSplit(30, 2); // item 30 was rejected from the LOSER

    const moved = await mergeClusters(1, 2, tdb);

    expect(moved).toBe(1);
    expect(await clusterIdOf(20)).toBeNull(); // split-guarded → unlinked, NOT reunited
    expect(await clusterIdOf(21)).toBe(1); // moved into winner
    expect(await clusterIdOf(30)).toBeNull(); // untouched

    const winner = await clusterRow(1);
    expect(Number(winner!.member_count)).toBe(2); // 1 + 1 moved (not + 2)
    expect(Number(winner!.coverage)).toBe(2); // lockstep

    expect(await clusterRow(2)).toBeNull(); // loser row deleted

    // Loser's negative edge (30 rejected from loser 2) transferred to winner 1;
    // winner's own edge (20,1) kept; no edge left pointing at the deleted loser.
    expect(await splitPairs()).toEqual([
      [20, 1],
      [30, 1],
    ]);
  });

  it("empty loser: nothing moves, no stamp reset, loser still deleted", async () => {
    await seedCluster({ id: 1, leadItemId: 10, memberCount: 1, coverage: 1 });
    await seedCluster({ id: 2, leadItemId: 20, memberCount: 0, coverage: 0 });
    await seedItem({ id: 10, clusterId: 1 });

    const moved = await mergeClusters(1, 2, tdb);

    expect(moved).toBe(0);
    const winner = await clusterRow(1);
    expect(Number(winner!.member_count)).toBe(1); // unchanged
    expect(winner!.verified_at).toBeNull(); // not reset (was null; would be a stamp reset if bug)
    expect(await clusterRow(2)).toBeNull();
  });
});

// ── arbitrate lead re-pick ────────────────────────────────────────────────────

describe("applySplitVerdict — lead integrity on split (W2)", () => {
  it("re-points lead_item_id to a survivor when the ejected set includes the lead", async () => {
    await seedCluster({
      id: 1,
      leadItemId: 100,
      memberCount: 3,
      coverage: 3,
      verifiedAt: null,
    });
    await seedItem({ id: 100, clusterId: 1, importance: 70 });
    await seedItem({ id: 101, clusterId: 1, importance: 90 });
    await seedItem({ id: 102, clusterId: 1, importance: 50 });

    const members = [
      member({ itemId: 100, sourceGroup: "media", importance: 70 }),
      member({ itemId: 101, sourceGroup: "media", importance: 90 }),
      member({ itemId: 102, sourceGroup: "social", importance: 50 }),
    ];

    const unlinked = await applySplitVerdict(1, 100, members, [100], "off-topic", tdb);

    expect(unlinked).toBe(1);
    expect(await clusterIdOf(100)).toBeNull(); // lead ejected → unlinked
    expect(await clusterIdOf(101)).toBe(1);
    expect(await clusterIdOf(102)).toBe(1);

    const c = await clusterRow(1);
    const newLead = Number(c!.lead_item_id);
    expect([101, 102]).toContain(newLead); // a survivor
    expect(newLead).not.toBe(100); // never the ejected lead
    expect(newLead).toBe(101); // strongest survivor (media, importance 90)
    expect(Number(c!.member_count)).toBe(2); // 3 - 1 real unlink
    expect(Number(c!.coverage)).toBe(2); // lockstep
    expect(c!.verified_at).not.toBeNull();
    expect(c!.importance).not.toBeNull(); // recomputed from survivors

    expect(await splitPairs()).toEqual([[100, 1]]); // audit edge written once
  });

  it("does not re-point when the lead survives the split", async () => {
    await seedCluster({ id: 1, leadItemId: 200, memberCount: 3, coverage: 3 });
    await seedItem({ id: 200, clusterId: 1, importance: 90 });
    await seedItem({ id: 201, clusterId: 1, importance: 40 });
    await seedItem({ id: 202, clusterId: 1, importance: 40 });

    const members = [
      member({ itemId: 200, importance: 90 }),
      member({ itemId: 201, importance: 40 }),
      member({ itemId: 202, importance: 40 }),
    ];

    await applySplitVerdict(1, 200, members, [201], "off-topic", tdb);

    const c = await clusterRow(1);
    expect(Number(c!.lead_item_id)).toBe(200); // lead untouched
    expect(Number(c!.member_count)).toBe(2);
    expect(await clusterIdOf(201)).toBeNull();
  });
});

// ── reconcile ─────────────────────────────────────────────────────────────────

describe("reconcileClusters — standing repair (W3)", () => {
  it("unlinks orphans, GCs old zombies, spares young ones, recomputes counts, re-points dangling leads", async () => {
    const now = Date.now();

    // cluster 1: member_count drift (says 5, really 2)
    await seedCluster({ id: 1, leadItemId: 10, memberCount: 5, coverage: 5 });
    await seedItem({ id: 10, clusterId: 1, clusteredAt: now - 1000 });
    await seedItem({ id: 11, clusterId: 1, clusteredAt: now - 500 });

    // cluster 2: OLD zombie (no members, first_seen well past the age guard)
    await seedCluster({
      id: 2,
      leadItemId: 99,
      memberCount: 1,
      coverage: 1,
      firstSeenAt: now - 10 * 60_000,
    });

    // cluster 3: YOUNG in-flight cluster (drifted count, 0 members, just born)
    await seedCluster({
      id: 3,
      leadItemId: 98,
      memberCount: 3,
      coverage: 3,
      firstSeenAt: now,
    });

    // cluster 4: dangling lead (lead 999 is not a member)
    await seedCluster({ id: 4, leadItemId: 999, memberCount: 2, coverage: 2 });
    await seedItem({ id: 40, clusterId: 4, importance: 30 });
    await seedItem({ id: 41, clusterId: 4, importance: 80 });

    // orphan item: points at a cluster that doesn't exist
    await seedItem({ id: 50, clusterId: 777 });

    const rep = await reconcileClusters({ apply: true, client });

    expect(rep.orphanItemsUnlinked).toBe(1);
    expect(rep.zombiesDeleted).toBe(1);
    expect(rep.aggregatesFixed).toBe(1); // only cluster 1
    expect(rep.leadsRepointed).toBe(1); // only cluster 4

    // cluster 1 aggregates corrected to reality
    const c1 = await clusterRow(1);
    expect(Number(c1!.member_count)).toBe(2);
    expect(Number(c1!.coverage)).toBe(2);
    expect(Number(c1!.latest_member_at)).toBe(now - 500); // max(clustered_at)

    expect(await clusterRow(2)).toBeNull(); // old zombie GC'd

    const c3 = await clusterRow(3); // young cluster untouched by BOTH guards
    expect(c3).not.toBeNull();
    expect(Number(c3!.member_count)).toBe(3);

    const c4 = await clusterRow(4);
    expect([40, 41]).toContain(Number(c4!.lead_item_id)); // re-pointed to a member

    expect(await clusterIdOf(50)).toBeNull(); // orphan unlinked

    // Idempotent: a second dry-run pass over clean data reports nothing.
    const rep2 = await reconcileClusters({ apply: false, client });
    expect(rep2.orphanItemsUnlinked).toBe(0);
    expect(rep2.zombiesDeleted).toBe(0);
    expect(rep2.aggregatesFixed).toBe(0);
    expect(rep2.leadsRepointed).toBe(0);
  });
});
