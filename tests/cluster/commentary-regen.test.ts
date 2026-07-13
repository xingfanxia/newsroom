/**
 * Behavioral test for the commentary regeneration trigger (commentary.ts, W6b).
 *
 * Runs the REAL `commentaryRegenClause` SQL against a fresh file-backed libSQL
 * DB so the three regen arms — never-commented / grew-2× / tier-upgrade — and
 * their loop-safety guards are exercised against actual SQLite, without paying
 * for the LLM path the batch runner wraps the clause in.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { asc } from "drizzle-orm";
import * as schema from "@/db/schema";
import { commentaryRegenClause } from "@/workers/cluster/commentary";

// Only the columns the clause references — drizzle emits SQL for these alone.
const DDL = `
CREATE TABLE clusters (
  id INTEGER PRIMARY KEY,
  commentary_at INTEGER,
  member_count INTEGER NOT NULL DEFAULT 0,
  commentary_member_count INTEGER,
  event_tier TEXT,
  editor_analysis_zh TEXT
);
`;

let client: Client;
let tdb: ReturnType<typeof drizzle<typeof schema>>;
let dbPath: string;

const COMMENTED = 1000; // any non-null commentary_at (ms epoch)

beforeEach(async () => {
  dbPath = join(tmpdir(), `newsroom-commentary-regen-${crypto.randomUUID()}.db`);
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

async function seed(rows: Array<{
  id: number;
  commentaryAt: number | null;
  memberCount: number;
  commentaryMemberCount: number | null;
  eventTier: string | null;
  editorAnalysisZh: string | null;
}>) {
  for (const r of rows) {
    await client.execute({
      sql: `INSERT INTO clusters
              (id, commentary_at, member_count, commentary_member_count,
               event_tier, editor_analysis_zh)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        r.id,
        r.commentaryAt,
        r.memberCount,
        r.commentaryMemberCount,
        r.eventTier,
        r.editorAnalysisZh,
      ],
    });
  }
}

async function selectedIds(): Promise<number[]> {
  const rows = await tdb
    .select({ id: schema.clusters.id })
    .from(schema.clusters)
    .where(commentaryRegenClause())
    .orderBy(asc(schema.clusters.id));
  return rows.map((r) => r.id);
}

describe("commentaryRegenClause (W6b)", () => {
  it("selects a never-commented cluster (arm a)", async () => {
    await seed([
      {
        id: 1,
        commentaryAt: null,
        memberCount: 2,
        commentaryMemberCount: null,
        eventTier: "all",
        editorAnalysisZh: null,
      },
    ]);
    expect(await selectedIds()).toEqual([1]);
  });

  it("selects a cluster that grew to ≥2× its last-commentary count (arm b)", async () => {
    await seed([
      {
        id: 1,
        commentaryAt: COMMENTED,
        memberCount: 10,
        commentaryMemberCount: 2, // 10 >= 2*2 → regen
        eventTier: "all",
        editorAnalysisZh: null,
      },
    ]);
    expect(await selectedIds()).toEqual([1]);
  });

  it("does NOT select a cluster that grew but stayed under 2× (loop-safety)", async () => {
    await seed([
      {
        id: 1,
        commentaryAt: COMMENTED,
        memberCount: 3,
        commentaryMemberCount: 2, // 3 >= 4 is false
        eventTier: "all",
        editorAnalysisZh: null,
      },
    ]);
    expect(await selectedIds()).toEqual([]);
  });

  it("selects a featured/p1 cluster whose full analysis was never written (arm c)", async () => {
    await seed([
      {
        id: 1,
        commentaryAt: COMMENTED,
        memberCount: 2,
        commentaryMemberCount: 2, // no growth
        eventTier: "featured",
        editorAnalysisZh: null, // note-only at a lower tier before → regen
      },
    ]);
    expect(await selectedIds()).toEqual([1]);
  });

  it("does NOT re-select a featured cluster once the analysis is written (loop-safety)", async () => {
    await seed([
      {
        id: 1,
        commentaryAt: COMMENTED,
        memberCount: 2,
        commentaryMemberCount: 2,
        eventTier: "featured",
        editorAnalysisZh: "锐评已写", // arm c goes false after a full pass
      },
    ]);
    expect(await selectedIds()).toEqual([]);
  });

  it("does NOT thrash pre-column rows with NULL commentary_member_count", async () => {
    // A row commented before the commentary_member_count column existed: the
    // 2× arm evaluates NULL/false, and 'all' tier keeps arm c false, so it
    // never re-fires — exactly the no-thrash guarantee.
    await seed([
      {
        id: 1,
        commentaryAt: COMMENTED,
        memberCount: 10,
        commentaryMemberCount: null,
        eventTier: "all",
        editorAnalysisZh: null,
      },
    ]);
    expect(await selectedIds()).toEqual([]);
  });

  it("selects exactly the qualifying rows out of a mixed batch", async () => {
    await seed([
      // arm a — never commented
      { id: 1, commentaryAt: null, memberCount: 2, commentaryMemberCount: null, eventTier: "all", editorAnalysisZh: null },
      // arm b — grew 2×
      { id: 2, commentaryAt: COMMENTED, memberCount: 10, commentaryMemberCount: 2, eventTier: "all", editorAnalysisZh: null },
      // under 2× — held
      { id: 3, commentaryAt: COMMENTED, memberCount: 3, commentaryMemberCount: 2, eventTier: "all", editorAnalysisZh: null },
      // arm c — tier upgrade, analysis missing
      { id: 4, commentaryAt: COMMENTED, memberCount: 2, commentaryMemberCount: 2, eventTier: "featured", editorAnalysisZh: null },
      // analysis written — held
      { id: 5, commentaryAt: COMMENTED, memberCount: 2, commentaryMemberCount: 2, eventTier: "featured", editorAnalysisZh: "x" },
    ]);
    expect(await selectedIds()).toEqual([1, 2, 4]);
  });
});
