import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import {
  PUBLIC_CONTENT_OUTBOX_MIGRATION,
  PUBLIC_CONTENT_OUTBOX_MIGRATION_CHECKSUM,
  PUBLIC_CONTENT_OUTBOX_TRIGGER_NAMES,
  migratePublicContentOutbox,
} from "@/lib/public-content/publisher/outbox-migration";

let client: Client;
let fixtureRoot: string;

const BASE_SCHEMA = [
  `CREATE TABLE sources (
    id TEXT PRIMARY KEY,
    name_en TEXT NOT NULL, name_zh TEXT NOT NULL, url TEXT NOT NULL,
    kind TEXT NOT NULL, "group" TEXT NOT NULL, locale TEXT NOT NULL,
    cadence TEXT NOT NULL, priority INTEGER NOT NULL, tags TEXT NOT NULL,
    enabled INTEGER NOT NULL, curated INTEGER NOT NULL,
    never_exclude INTEGER NOT NULL DEFAULT 0,
    clustering_opt_out INTEGER NOT NULL DEFAULT 0,
    notes TEXT, created_at INTEGER, updated_at INTEGER
  )`,
  `CREATE TABLE source_health (
    source_id TEXT PRIMARY KEY, status TEXT NOT NULL,
    last_fetched_at INTEGER, last_success_at INTEGER, last_error TEXT,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    last_items_count INTEGER NOT NULL DEFAULT 0,
    total_items_count INTEGER NOT NULL DEFAULT 0,
    last_external_id TEXT, updated_at INTEGER
  )`,
  `CREATE TABLE clusters (
    id INTEGER PRIMARY KEY, lead_item_id INTEGER NOT NULL,
    member_count INTEGER NOT NULL DEFAULT 1, coverage INTEGER NOT NULL DEFAULT 1,
    first_seen_at INTEGER NOT NULL, latest_member_at INTEGER,
    canonical_title_zh TEXT, canonical_title_en TEXT, titled_at INTEGER,
    summary_zh TEXT, summary_en TEXT,
    editor_note_zh TEXT, editor_note_en TEXT,
    editor_analysis_zh TEXT, editor_analysis_en TEXT,
    commentary_at INTEGER, commentary_member_count INTEGER,
    no_content INTEGER NOT NULL DEFAULT 0, importance INTEGER,
    event_tier TEXT, hkr TEXT, verified_at INTEGER, updated_at INTEGER
  )`,
  `CREATE TABLE items (
    id INTEGER PRIMARY KEY, source_id TEXT NOT NULL, raw_item_id INTEGER,
    title TEXT NOT NULL, title_zh TEXT, title_en TEXT,
    summary_zh TEXT, summary_en TEXT,
    editor_note_zh TEXT, editor_note_en TEXT,
    editor_analysis_zh TEXT, editor_analysis_en TEXT,
    body_md TEXT, body TEXT, author TEXT, url TEXT NOT NULL,
    canonical_url TEXT NOT NULL, content_hash TEXT,
    tags TEXT, importance INTEGER, tier TEXT, hkr TEXT,
    reasoning TEXT, reasoning_zh TEXT, reasoning_en TEXT,
    published_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
    enriched_at INTEGER, commentary_at INTEGER, cluster_id INTEGER,
    policy_version TEXT, updated_at INTEGER
  )`,
  `CREATE INDEX items_cluster_idx ON items (cluster_id, published_at)`,
  `CREATE TABLE newsletters (
    id INTEGER PRIMARY KEY, kind TEXT NOT NULL, locale TEXT NOT NULL,
    period_start INTEGER NOT NULL, period_end INTEGER NOT NULL,
    headline TEXT, overview TEXT, highlights TEXT, commentary TEXT,
    column_title TEXT, column_summary_md TEXT, column_narrative_md TEXT,
    column_featured_item_ids TEXT, column_theme_tag TEXT,
    aihot_daily_payload TEXT, aihot_daily_date TEXT, item_ids TEXT,
    story_count INTEGER NOT NULL DEFAULT 0, published_at INTEGER NOT NULL
  )`,
  `CREATE TABLE policy_versions (
    id INTEGER PRIMARY KEY, skill_name TEXT NOT NULL, version INTEGER NOT NULL,
    content TEXT NOT NULL, reasoning TEXT, feedback_sample TEXT,
    feedback_count INTEGER NOT NULL DEFAULT 0, committed_by TEXT,
    committed_at INTEGER NOT NULL
  )`,
] as const;

beforeEach(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), "newsroom-outbox-"));
  client = createClient({ url: `file:${join(fixtureRoot, "outbox.sqlite")}` });
  await client.batch([...BASE_SCHEMA], "write");
});

afterEach(async () => {
  client.close();
  await rm(fixtureRoot, { recursive: true, force: true });
});

type OutboxRow = {
  entity_type: string;
  entity_key: string;
  operation: string;
};

async function outbox(): Promise<OutboxRow[]> {
  const result = await client.execute(
    `SELECT entity_type, entity_key, operation
     FROM public_content_outbox ORDER BY id`,
  );
  return result.rows.map((row) => ({
    entity_type: String(row.entity_type),
    entity_key: String(row.entity_key),
    operation: String(row.operation),
  }));
}

async function clearOutbox(): Promise<void> {
  await client.execute("DELETE FROM public_content_outbox");
}

async function install(): Promise<void> {
  const result = await migratePublicContentOutbox(client);
  expect(result.applied).toBe(true);
}

describe("public content outbox migration", () => {
  test("installs checksummed schema and every trigger exactly once", async () => {
    const first = await migratePublicContentOutbox(client);
    expect(first).toEqual({
      name: PUBLIC_CONTENT_OUTBOX_MIGRATION,
      checksum: PUBLIC_CONTENT_OUTBOX_MIGRATION_CHECKSUM,
      applied: true,
    });

    const triggerRows = await client.execute(
      `SELECT name FROM sqlite_master
       WHERE type = 'trigger' AND name LIKE 'public_%' ORDER BY name`,
    );
    expect(triggerRows.rows.map((row) => String(row.name))).toEqual(
      [...PUBLIC_CONTENT_OUTBOX_TRIGGER_NAMES].sort(),
    );
    const indexRows = await client.execute(
      `SELECT name FROM sqlite_master
       WHERE type = 'index' AND name = 'public_content_outbox_entity_idx'`,
    );
    expect(indexRows.rows).toHaveLength(1);

    const second = await migratePublicContentOutbox(client);
    expect(second).toEqual({ ...first, applied: false });
    const migration = await client.execute({
      sql: "SELECT checksum FROM schema_migrations WHERE name = ?",
      args: [PUBLIC_CONTENT_OUTBOX_MIGRATION],
    });
    expect(String(migration.rows[0]?.checksum)).toBe(
      PUBLIC_CONTENT_OUTBOX_MIGRATION_CHECKSUM,
    );
  });

  test("rejects a same-name migration with a different checksum", async () => {
    await client.execute(`CREATE TABLE schema_migrations (
      name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL
    )`);
    await client.execute({
      sql: `INSERT INTO schema_migrations (name, checksum, applied_at)
            VALUES (?, 'wrong-checksum', 1)`,
      args: [PUBLIC_CONTENT_OUTBOX_MIGRATION],
    });

    await expect(migratePublicContentOutbox(client)).rejects.toThrow(
      /migration checksum mismatch/,
    );
    const table = await client.execute(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name = 'public_content_outbox'`,
    );
    expect(table.rows).toHaveLength(0);
  });

  test("item triggers ignore private/same-value writes and retain OLD+NEW dependencies", async () => {
    await install();
    await client.batch([
      `INSERT INTO clusters
       (id, lead_item_id, member_count, coverage, first_seen_at,
        no_content, importance, event_tier)
       VALUES (10, 1, 2, 2, 1, 0, 80, 'all'),
              (11, 1, 2, 2, 1, 0, 80, 'all')`,
      `INSERT INTO items
       (id, source_id, title, url, canonical_url, published_at, created_at,
        body, reasoning)
       VALUES (1, 'alpha', 'one', 'https://example.com/1',
        'https://example.com/1', 100, 100, 'raw', 'private')`,
    ], "write");
    await clearOutbox();

    await client.execute("UPDATE items SET reasoning = 'changed' WHERE id = 1");
    await client.execute("UPDATE items SET body = 'changed raw body' WHERE id = 1");
    expect(await outbox()).toEqual([]);

    await client.execute(
      `UPDATE items SET enriched_at = 101, importance = 70, tier = 'all'
       WHERE id = 1`,
    );
    expect(await outbox()).toEqual([
      { entity_type: "item", entity_key: "1", operation: "upsert" },
    ]);
    await clearOutbox();

    await client.execute("UPDATE items SET title = title WHERE id = 1");
    expect(await outbox()).toEqual([]);
    await client.execute("UPDATE items SET title = 'renamed' WHERE id = 1");
    expect(await outbox()).toEqual([
      { entity_type: "item", entity_key: "1", operation: "upsert" },
    ]);
    await clearOutbox();

    await client.execute("UPDATE items SET cluster_id = 10 WHERE id = 1");
    expect(await outbox()).toEqual([
      { entity_type: "item", entity_key: "1", operation: "upsert" },
      { entity_type: "event", entity_key: "10", operation: "upsert" },
    ]);
    await clearOutbox();

    await client.execute("UPDATE items SET cluster_id = 11 WHERE id = 1");
    expect(await outbox()).toEqual([
      { entity_type: "item", entity_key: "1", operation: "upsert" },
      { entity_type: "event", entity_key: "10", operation: "upsert" },
      { entity_type: "event", entity_key: "11", operation: "upsert" },
    ]);
    await clearOutbox();

    await client.execute("UPDATE items SET tier = 'excluded' WHERE id = 1");
    expect(await outbox()).toEqual([
      { entity_type: "item", entity_key: "1", operation: "delete" },
      { entity_type: "event", entity_key: "11", operation: "upsert" },
    ]);
    await client.execute("UPDATE items SET tier = 'all' WHERE id = 1");
    await clearOutbox();
    await client.execute("DELETE FROM items WHERE id = 1");
    expect(await outbox()).toEqual([
      { entity_type: "item", entity_key: "1", operation: "delete" },
      { entity_type: "event", entity_key: "11", operation: "upsert" },
    ]);
  });

  test("entity triggers cover only public source/event/newsletter/policy changes", async () => {
    await install();
    await client.execute(
      `INSERT INTO sources
       (id, name_en, name_zh, url, kind, "group", locale, cadence,
        priority, tags, enabled, curated, notes)
       VALUES ('alpha', 'Alpha', '阿尔法', 'https://example.com', 'rss',
        'media', 'en', 'daily', 1, '[]', 1, 0, 'private')`,
    );
    expect(await outbox()).toEqual([
      { entity_type: "source", entity_key: "alpha", operation: "upsert" },
    ]);
    await clearOutbox();
    await client.execute("UPDATE sources SET notes = 'changed' WHERE id = 'alpha'");
    expect(await outbox()).toEqual([]);
    await client.execute("UPDATE sources SET name_en = 'Alpha 2' WHERE id = 'alpha'");
    expect(await outbox()).toHaveLength(1);
    await clearOutbox();

    await client.execute(
      `INSERT INTO source_health
       (source_id, status, last_error, consecutive_failures, total_items_count)
       VALUES ('alpha', 'ok', 'private', 0, 1)`,
    );
    expect(await outbox()).toHaveLength(1);
    await clearOutbox();
    await client.execute(
      "UPDATE source_health SET last_error = 'private 2' WHERE source_id = 'alpha'",
    );
    expect(await outbox()).toEqual([]);
    await client.execute(
      "UPDATE source_health SET total_items_count = 2 WHERE source_id = 'alpha'",
    );
    expect(await outbox()).toHaveLength(1);
    await clearOutbox();
    await client.execute("DELETE FROM source_health WHERE source_id = 'alpha'");
    expect(await outbox()).toEqual([
      { entity_type: "source", entity_key: "alpha", operation: "upsert" },
    ]);
    await clearOutbox();

    await client.execute(
      `INSERT INTO clusters
       (id, lead_item_id, member_count, coverage, first_seen_at,
        no_content, importance, event_tier, verified_at)
       VALUES (20, 1, 2, 2, 1, 0, 90, 'featured', 1)`,
    );
    expect(await outbox()).toEqual([
      { entity_type: "event", entity_key: "20", operation: "upsert" },
    ]);
    await clearOutbox();
    await client.execute("UPDATE clusters SET verified_at = 2 WHERE id = 20");
    expect(await outbox()).toEqual([]);
    await client.execute(
      "UPDATE clusters SET canonical_title_en = 'Event' WHERE id = 20",
    );
    expect(await outbox()).toHaveLength(1);
    await clearOutbox();
    await client.execute("UPDATE clusters SET member_count = 1 WHERE id = 20");
    expect(await outbox()).toEqual([
      { entity_type: "event", entity_key: "20", operation: "delete" },
    ]);
    await client.execute("UPDATE clusters SET member_count = 2 WHERE id = 20");
    await clearOutbox();
    await client.execute("DELETE FROM clusters WHERE id = 20");
    expect(await outbox()).toEqual([
      { entity_type: "event", entity_key: "20", operation: "delete" },
    ]);
    await clearOutbox();

    await client.execute(
      `INSERT INTO newsletters
       (id, kind, locale, period_start, period_end, headline,
        aihot_daily_payload, story_count, published_at)
       VALUES (30, 'daily', 'en', 1, 2, 'Digest', 'private', 1, 3)`,
    );
    expect((await outbox()).at(-1)).toEqual({
      entity_type: "newsletter",
      entity_key: "30",
      operation: "upsert",
    });
    await clearOutbox();
    await client.execute(
      "UPDATE newsletters SET aihot_daily_payload = 'private 2' WHERE id = 30",
    );
    expect(await outbox()).toEqual([]);
    await client.execute("UPDATE newsletters SET headline = 'Digest 2' WHERE id = 30");
    expect(await outbox()).toHaveLength(1);
    await clearOutbox();
    await client.execute("DELETE FROM newsletters WHERE id = 30");
    expect(await outbox()).toEqual([
      { entity_type: "newsletter", entity_key: "30", operation: "delete" },
    ]);
    await clearOutbox();

    await client.execute(
      `INSERT INTO policy_versions
       (id, skill_name, version, content, reasoning, committed_at)
       VALUES (40, 'other', 1, 'private', 'private', 1),
              (41, 'editorial', 1, 'public policy', 'private', 1)`,
    );
    expect(await outbox()).toEqual([
      { entity_type: "policy", entity_key: "editorial", operation: "upsert" },
    ]);
    await clearOutbox();
    await client.execute(
      "UPDATE policy_versions SET reasoning = 'private 2' WHERE id = 41",
    );
    expect(await outbox()).toEqual([]);
    await client.execute(
      "UPDATE policy_versions SET content = 'public policy 2' WHERE id = 41",
    );
    expect(await outbox()).toHaveLength(1);
    await clearOutbox();
    await client.execute("DELETE FROM policy_versions WHERE id = 41");
    expect(await outbox()).toEqual([
      { entity_type: "policy", entity_key: "editorial", operation: "upsert" },
    ]);
    await clearOutbox();
    await client.execute("DELETE FROM sources WHERE id = 'alpha'");
    expect(await outbox()).toEqual([
      { entity_type: "source", entity_key: "alpha", operation: "delete" },
    ]);
  });

  test("captured high-water acknowledgement preserves concurrent rows and uses bounded plans", async () => {
    await install();
    await client.batch([
      `INSERT INTO public_content_outbox (entity_type, entity_key, operation)
       VALUES ('item', '1', 'upsert')`,
      `INSERT INTO public_content_outbox (entity_type, entity_key, operation)
       VALUES ('source', 'alpha', 'upsert')`,
    ], "write");
    const maximum = await client.execute(
      "SELECT COALESCE(MAX(id), 0) AS high_water FROM public_content_outbox",
    );
    const highWater = Number(maximum.rows[0]?.high_water);
    await client.execute(
      `INSERT INTO public_content_outbox (entity_type, entity_key, operation)
       VALUES ('item', '2', 'upsert')`,
    );
    await client.execute({
      sql: "DELETE FROM public_content_outbox WHERE id <= ?",
      args: [highWater],
    });
    expect(await outbox()).toEqual([
      { entity_type: "item", entity_key: "2", operation: "upsert" },
    ]);

    await client.execute(
      `INSERT INTO items
       (id, source_id, title, url, canonical_url, published_at, created_at, body)
       VALUES (1, 'alpha', 'one', 'https://example.com/1',
        'https://example.com/1', 100, 100, 'raw')`,
    );
    const plans = await Promise.all([
      explain(
        "SELECT id FROM public_content_outbox WHERE id > 0 AND id <= 999 ORDER BY id",
      ),
      explain("SELECT id FROM items WHERE id = 1"),
      explain(
        "SELECT id FROM items INDEXED BY items_cluster_idx WHERE cluster_id = 10 ORDER BY published_at DESC",
      ),
      explain(
        `SELECT id FROM public_content_outbox
         WHERE entity_type = 'item' AND entity_key = '1' ORDER BY id`,
      ),
    ]);
    expect(plans[0]).toMatch(/INTEGER PRIMARY KEY|rowid/i);
    expect(plans[1]).toMatch(/INTEGER PRIMARY KEY|rowid/i);
    expect(plans[2]).toContain("items_cluster_idx");
    expect(plans[3]).toContain("public_content_outbox_entity_idx");
  });
});

async function explain(sql: string): Promise<string> {
  const result = await client.execute(`EXPLAIN QUERY PLAN ${sql}`);
  return result.rows.map((row) => String(row.detail ?? "")).join("\n");
}
