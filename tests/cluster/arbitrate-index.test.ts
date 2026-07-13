/**
 * Plan + behavior test for the arbitrate/canonical-title candidate scan
 * acceleration (FIX-W7 / A3).
 *
 * Both stages select `member_count >= 2 AND <needs-work>` ORDER BY
 * `member_count DESC, updated_at DESC` with no supporting index — a full scan of
 * all ~16K clusters every tick. A partial index on (member_count, updated_at)
 * WHERE member_count >= 2 holds only the ~1.1K multi-member clusters in the
 * query's sort order. This test proves (a) the planner picks it WITHOUT an
 * INDEXED BY pin (partial-index selection is structural, not stats-based, so it
 * survives Turso's missing ANALYZE), and (b) the accelerated query still
 * returns exactly the clusters needing work.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";

const PARTIAL_INDEX = `
CREATE INDEX IF NOT EXISTS clusters_multimember_idx
  ON clusters (member_count, updated_at)
  WHERE member_count >= 2
`;

const DDL = `
CREATE TABLE clusters (
  id INTEGER PRIMARY KEY,
  lead_item_id INTEGER NOT NULL DEFAULT 0,
  member_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0,
  verified_at INTEGER,
  titled_at INTEGER,
  canonical_title_zh TEXT
);
CREATE TABLE items (
  id INTEGER PRIMARY KEY,
  cluster_id INTEGER,
  cluster_verified_at INTEGER
);
${PARTIAL_INDEX};
`;

// The arbitrate candidate query — a faithful mirror of the drizzle builder in
// runArbitrationBatch (same WHERE/ORDER BY/LIMIT). Unpinned, exactly as
// production emits it. LIMIT = MAX_ARBITRATIONS_PER_RUN (15).
const ARBITRATE_SQL = `
  SELECT c.id, c.lead_item_id, c.member_count
  FROM clusters c
  WHERE c.member_count >= 2
    AND (
      c.verified_at IS NULL
      OR EXISTS (
        SELECT 1 FROM items i
        WHERE i.cluster_id = c.id AND i.cluster_verified_at IS NULL
      )
    )
  ORDER BY c.member_count DESC, c.updated_at DESC
  LIMIT 15
`;

// The canonical-title candidate query — mirror of the runCanonicalTitleBatch
// builder, including the `canonical_title_zh IS NULL` branch (never given a zh
// title). LIMIT = MAX_TITLES_PER_RUN (15).
const TITLE_SQL = `
  SELECT c.id, c.member_count
  FROM clusters c
  WHERE c.member_count >= 2
    AND (
      c.canonical_title_zh IS NULL
      OR c.titled_at IS NULL
      OR c.updated_at > c.titled_at
    )
  ORDER BY c.member_count DESC, c.updated_at DESC
  LIMIT 15
`;

let client: Client;
let dbPath: string;

beforeEach(async () => {
  dbPath = join(tmpdir(), `newsroom-arb-idx-${crypto.randomUUID()}.db`);
  client = createClient({ url: `file:${dbPath}` });
  await client.executeMultiple(DDL);
});

afterEach(() => {
  client.close();
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(`${dbPath}${suffix}`, { force: true });
  }
});

async function plan(sql: string): Promise<string> {
  const res = await client.execute(`EXPLAIN QUERY PLAN ${sql}`);
  return res.rows.map((r) => String((r as { detail?: string }).detail)).join("\n");
}

async function seedCluster(o: {
  id: number;
  memberCount: number;
  verifiedAt?: number | null;
  titledAt?: number | null;
  updatedAt?: number;
  canonicalTitleZh?: string | null;
}) {
  await client.execute({
    sql: `INSERT INTO clusters
            (id, lead_item_id, member_count, updated_at, verified_at,
             titled_at, canonical_title_zh)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      o.id,
      o.id * 10,
      o.memberCount,
      o.updatedAt ?? 1000,
      o.verifiedAt ?? null,
      o.titledAt ?? null,
      o.canonicalTitleZh ?? null,
    ],
  });
}

describe("A3 partial index — planner selection (no pin)", () => {
  it("arbitrate candidate scan uses clusters_multimember_idx, not a full SCAN", async () => {
    for (let i = 1; i <= 50; i++) {
      await seedCluster({ id: i, memberCount: i <= 5 ? 3 : 1 });
    }
    const p = await plan(ARBITRATE_SQL);
    expect(p).toContain("clusters_multimember_idx");
    expect(p).not.toMatch(/SCAN clusters\b(?! USING)/);
  });

  it("canonical-title candidate scan uses clusters_multimember_idx", async () => {
    for (let i = 1; i <= 50; i++) {
      await seedCluster({ id: i, memberCount: i <= 5 ? 3 : 1 });
    }
    const p = await plan(TITLE_SQL);
    expect(p).toContain("clusters_multimember_idx");
  });
});

describe("A3 partial index — behavior preserved", () => {
  it("arbitrate still returns only multi-member clusters needing work", async () => {
    await seedCluster({ id: 1, memberCount: 3, verifiedAt: null }); // never verified
    await seedCluster({ id: 2, memberCount: 4, verifiedAt: 5000 }); // verified, no unverified members
    await seedCluster({ id: 3, memberCount: 1, verifiedAt: null }); // singleton — excluded
    // cluster 2 has all members verified → excluded via the EXISTS branch
    await client.execute(`INSERT INTO items (id, cluster_id, cluster_verified_at) VALUES (20, 2, 5000)`);

    const res = await client.execute(ARBITRATE_SQL);
    expect(res.rows.map((r) => Number(r.id))).toEqual([1]);
  });

  it("canonical-title returns untitled, un-zh-titled, and grown-since-titled clusters", async () => {
    // untitled (titled_at NULL) → included
    await seedCluster({ id: 1, memberCount: 3, titledAt: null });
    // grew after title (updated_at > titled_at), has zh title → included
    await seedCluster({
      id: 2,
      memberCount: 5,
      titledAt: 1000,
      updatedAt: 2000,
      canonicalTitleZh: "标题",
    });
    // titled + has zh + unchanged → EXCLUDED (all three branches false)
    await seedCluster({
      id: 3,
      memberCount: 4,
      titledAt: 2000,
      updatedAt: 1000,
      canonicalTitleZh: "标题",
    });
    // titled + unchanged BUT no zh title yet → included via canonical_title_zh IS NULL
    await seedCluster({
      id: 5,
      memberCount: 2,
      titledAt: 2000,
      updatedAt: 1000,
      canonicalTitleZh: null,
    });
    await seedCluster({ id: 4, memberCount: 1, titledAt: null }); // singleton — excluded

    const res = await client.execute(TITLE_SQL);
    // member_count DESC → [2 (5), 1 (3), 5 (2)]
    expect(res.rows.map((r) => Number(r.id))).toEqual([2, 1, 5]);
  });
});
