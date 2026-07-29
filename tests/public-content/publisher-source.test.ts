import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { patchCanonicalPublicState } from "@/lib/public-content/publisher/patch-state";
import {
  exportCanonicalPublicState,
  LibsqlPublicContentSource,
  PUBLISHER_SOURCE_VERIFIED_PLANS,
  verifyPublisherSourcePlans,
} from "@/lib/public-content/publisher/source";

const NOW = Date.parse("2026-07-14T12:00:00.000Z");
const roots: string[] = [];
const clients: Client[] = [];

const FULL_SCHEMA = [
  `CREATE TABLE public_content_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_key TEXT NOT NULL,
    operation TEXT NOT NULL DEFAULT 'refresh',
    created_at INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE sources (
    id TEXT PRIMARY KEY,
    name_en TEXT NOT NULL, name_zh TEXT NOT NULL, url TEXT NOT NULL,
    kind TEXT NOT NULL, "group" TEXT NOT NULL, locale TEXT NOT NULL,
    cadence TEXT NOT NULL, priority INTEGER NOT NULL, tags TEXT NOT NULL,
    enabled INTEGER NOT NULL, curated INTEGER NOT NULL
  )`,
  `CREATE TABLE source_health (
    source_id TEXT PRIMARY KEY, status TEXT NOT NULL,
    last_success_at INTEGER, consecutive_failures INTEGER NOT NULL,
    total_items_count INTEGER NOT NULL
  )`,
  `CREATE TABLE clusters (
    id INTEGER PRIMARY KEY, lead_item_id INTEGER NOT NULL,
    member_count INTEGER NOT NULL, coverage INTEGER NOT NULL,
    first_seen_at INTEGER NOT NULL, latest_member_at INTEGER,
    canonical_title_zh TEXT, canonical_title_en TEXT,
    editor_note_zh TEXT, editor_note_en TEXT,
    editor_analysis_zh TEXT, editor_analysis_en TEXT,
    importance INTEGER, event_tier TEXT, hkr TEXT,
    no_content INTEGER NOT NULL
  )`,
  `CREATE TABLE items (
    id INTEGER PRIMARY KEY, source_id TEXT NOT NULL, cluster_id INTEGER,
    title TEXT NOT NULL, title_zh TEXT, title_en TEXT,
    summary_zh TEXT, summary_en TEXT,
    editor_note_zh TEXT, editor_note_en TEXT,
    editor_analysis_zh TEXT, editor_analysis_en TEXT,
    body_md TEXT, author TEXT, url TEXT NOT NULL, canonical_url TEXT NOT NULL,
    tags TEXT NOT NULL, importance INTEGER, tier TEXT, hkr TEXT,
    published_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
    enriched_at INTEGER, commentary_at INTEGER
  )`,
  `CREATE INDEX items_cluster_idx ON items (cluster_id, published_at)`,
  `CREATE INDEX items_source_idx ON items (source_id, published_at)`,
  `CREATE TABLE newsletters (
    id INTEGER PRIMARY KEY, kind TEXT NOT NULL, locale TEXT NOT NULL,
    period_start INTEGER NOT NULL, period_end INTEGER NOT NULL,
    published_at INTEGER NOT NULL, story_count INTEGER NOT NULL,
    item_ids TEXT NOT NULL, headline TEXT, overview TEXT, highlights TEXT,
    commentary TEXT, column_title TEXT, column_theme_tag TEXT,
    column_summary_md TEXT, column_narrative_md TEXT,
    column_featured_item_ids TEXT
  )`,
  `CREATE TABLE policy_versions (
    id INTEGER PRIMARY KEY, skill_name TEXT NOT NULL,
    version INTEGER NOT NULL, committed_at INTEGER NOT NULL
  )`,
  `CREATE INDEX policy_versions_latest_idx
   ON policy_versions (skill_name, committed_at DESC)`,
] as const;

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function database(schema: readonly string[] = FULL_SCHEMA): Promise<Client> {
  const root = await mkdtemp(join(tmpdir(), "newsroom-publisher-source-"));
  const client = createClient({ url: `file:${join(root, "fixture.sqlite")}` });
  roots.push(root);
  clients.push(client);
  await client.batch([...schema], "write");
  return client;
}

function loggingClient(client: Client, statements: string[]): Client {
  return new Proxy(client, {
    get(target, property) {
      if (property === "execute") {
        return async (statement: unknown, ...args: unknown[]) => {
          statements.push(
            typeof statement === "string"
              ? statement
              : String((statement as { sql?: unknown }).sql ?? ""),
          );
          return Reflect.apply(target.execute, target, [statement, ...args]);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as Client;
}

async function seedPublicData(client: Client): Promise<void> {
  const tags = JSON.stringify({ capabilities: [], entities: [], topics: ["ai"] });
  await client.batch(
    [
      `INSERT INTO sources
       (id, name_en, name_zh, url, kind, "group", locale, cadence,
        priority, tags, enabled, curated)
       VALUES ('source-a', 'Source A', '来源 A', 'https://example.com', 'rss',
               'media', 'en', 'hourly', 1, '["official"]', 1, 1)`,
      `INSERT INTO source_health
       (source_id, status, last_success_at, consecutive_failures, total_items_count)
       VALUES ('source-a', 'ok', ${NOW - 1_000}, 0, 4)`,
      `INSERT INTO clusters
       (id, lead_item_id, member_count, coverage, first_seen_at,
        latest_member_at, canonical_title_zh, canonical_title_en,
        editor_note_zh, editor_note_en, editor_analysis_zh,
        editor_analysis_en, importance, event_tier, hkr, no_content)
       VALUES
       (10, 1, 2, 2, ${NOW - 10_000}, ${NOW - 1_000}, '事件十', 'Event Ten',
        NULL, NULL, NULL, NULL, 80, 'all', NULL, 0),
       (11, 3, 2, 2, ${NOW - 9_000}, ${NOW - 900}, '事件十一', 'Event Eleven',
        NULL, NULL, NULL, NULL, 75, 'p1', NULL, 0)`,
      ...[1, 2, 3, 4].map((id) => {
        const cluster = id <= 2 ? 10 : 11;
        const tier = cluster === 10 ? "all" : "p1";
        return `INSERT INTO items
          (id, source_id, cluster_id, title, title_zh, title_en,
           summary_zh, summary_en, editor_note_zh, editor_note_en,
           editor_analysis_zh, editor_analysis_en, body_md, author, url,
           canonical_url, tags, importance, tier, hkr, published_at,
           created_at, enriched_at, commentary_at)
          VALUES (${id}, 'source-a', ${cluster}, 'Item ${id}', '项目 ${id}',
                  'Item ${id}', NULL, NULL, NULL, NULL, NULL, NULL, NULL,
                  NULL, 'https://example.com/${id}', 'https://example.com/${id}',
                  '${tags}', 70, '${tier}', NULL, ${NOW - 3_600_000},
                  ${NOW - 7_200_000}, ${NOW - 1_800_000}, NULL)`;
      }),
      `INSERT INTO newsletters
       (id, kind, locale, period_start, period_end, published_at, story_count,
        item_ids, headline, overview, highlights, commentary,
        column_title, column_theme_tag, column_summary_md,
        column_narrative_md, column_featured_item_ids)
       VALUES (20, 'daily', 'en', ${NOW - 86_400_000}, ${NOW - 1}, ${NOW}, 2,
               '[1,2]', 'Daily', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`,
      `INSERT INTO policy_versions (id, skill_name, version, committed_at)
       VALUES (1, 'editorial', 1, ${NOW - 2_000}),
              (2, 'editorial', 2, ${NOW - 1_000})`,
      `INSERT INTO public_content_outbox (entity_type, entity_key) VALUES
       ('item', '1'), ('item', '1'), ('event', '10'), ('event', '11'),
       ('source', 'source-a'), ('newsletter', '20'),
       ('policy', 'editorial'), ('item', '999')`,
    ],
    "write",
  );
}

const EMPTY_STATE = {
  schemaVersion: 1,
  items: [],
  events: [],
  sources: [],
  newsletters: [],
  policies: [],
} as const;

describe("bounded publisher source", () => {
  test("exports a canonical bootstrap state from public fields and captures the starting watermark", async () => {
    const client = await database();
    await seedPublicData(client);

    const exported = await exportCanonicalPublicState(client, {
      now: () => NOW,
      pageSize: 2,
    });

    expect(exported.sourceWatermark).toBe(8);
    expect(exported.state.items.map(({ id }) => id)).toEqual([1, 2, 3, 4]);
    expect(exported.state.events.map(({ id }) => id)).toEqual([10, 11]);
    expect(exported.state.sources.map(({ id }) => id)).toEqual(["source-a"]);
    expect(exported.state.newsletters.map(({ id }) => id)).toEqual([20]);
    expect(exported.state.policies.map(({ version }) => version)).toEqual(["v2"]);
    expect(exported.state.sources[0]?.itemCounts).toEqual({
      allTime: 4,
      last24h: 4,
    });
    expect(exported.telemetry.queryCount).toBeGreaterThanOrEqual(9);
  });

  test("does only one outbox watermark read when nothing changed", async () => {
    const client = await database([
      `CREATE TABLE public_content_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL,
        entity_key TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT 0
      )`,
    ]);
    const batch = await new LibsqlPublicContentSource(client).readBatch(0);

    expect(batch).toEqual({
      fromWatermark: 0,
      toWatermark: 0,
      changes: [],
      telemetry: {
        candidateRows: 0,
        dedupedEntities: 0,
        returnedRows: 0,
        scannedRows: 0,
        scanMeasurementKind: "plan_upper_bound",
        queryCount: 1,
        verifiedPlans: [...PUBLISHER_SOURCE_VERIFIED_PLANS],
      },
    });
  });

  test("dedupes keys, emits tombstones, and batches every event member", async () => {
    const client = await database();
    await seedPublicData(client);
    const statements: string[] = [];
    const source = new LibsqlPublicContentSource(
      loggingClient(client, statements),
      { now: () => NOW },
    );

    const batch = await source.readBatch(0);
    expect(batch.toWatermark).toBe(8);
    expect(batch.telemetry).toMatchObject({
      candidateRows: 8,
      dedupedEntities: 7,
      queryCount: 10,
      scanMeasurementKind: "plan_upper_bound",
      verifiedPlans: [...PUBLISHER_SOURCE_VERIFIED_PLANS],
    });
    expect(batch.telemetry.scannedRows).toBeGreaterThanOrEqual(
      batch.telemetry.returnedRows,
    );
    expect(
      statements.filter((sql) => sql.includes("INDEXED BY items_cluster_idx")),
    ).toHaveLength(1);

    const missing = batch.changes.find(
      (change) => change.entityType === "item" && change.entityKey === "999",
    );
    expect(missing?.value).toBeNull();
    expect(
      batch.changes
        .filter((change) => change.entityType === "item" && change.value)
        .map((change) => Number(change.entityKey))
        .sort((left, right) => left - right),
    ).toEqual([1, 2, 3, 4]);

    const patched = patchCanonicalPublicState(EMPTY_STATE, batch.changes);
    expect(patched.state.items.map(({ id }) => id)).toEqual([1, 2, 3, 4]);
    expect(patched.state.events.map(({ id }) => id)).toEqual([10, 11]);
    expect(patched.state.sources[0]?.itemCounts).toEqual({
      allTime: 4,
      last24h: 4,
    });
    expect(patched.state.policies.map(({ version }) => version)).toEqual(["v2"]);

    expect(await verifyPublisherSourcePlans(client)).toEqual([
      ...PUBLISHER_SOURCE_VERIFIED_PLANS,
    ]);
  });

  test("applies eligibility removals and additions without dangling entities", async () => {
    const client = await database();
    await seedPublicData(client);
    const source = new LibsqlPublicContentSource(client, { now: () => NOW });
    const initial = await source.readBatch(0);
    const firstState = patchCanonicalPublicState(
      EMPTY_STATE,
      initial.changes,
    ).state;

    await client.batch(
      [
        `UPDATE items SET tier = 'excluded' WHERE id = 1`,
        `INSERT INTO public_content_outbox (entity_type, entity_key)
         VALUES ('item', '1'), ('event', '10')`,
      ],
      "write",
    );
    const removed = await source.readBatch(initial.toWatermark);
    const removedState = patchCanonicalPublicState(
      firstState,
      removed.changes,
    ).state;
    expect(removedState.items.map(({ id }) => id)).toEqual([2, 3, 4]);
    expect(removedState.items.find(({ id }) => id === 2)?.eventId).toBeNull();
    expect(removedState.events.map(({ id }) => id)).toEqual([11]);
    expect(removedState.newsletters).toHaveLength(1);
    expect(removedState.newsletters[0]).toMatchObject({
      id: 20,
      storyCount: 1,
      itemIds: [2],
    });

    await client.batch(
      [
        `UPDATE items SET tier = 'all' WHERE id = 1`,
        `INSERT INTO public_content_outbox (entity_type, entity_key)
         VALUES ('item', '1'), ('event', '10')`,
      ],
      "write",
    );
    const added = await source.readBatch(removed.toWatermark);
    const restoredState = patchCanonicalPublicState(
      removedState,
      added.changes,
    ).state;
    expect(restoredState.items.map(({ id }) => id)).toEqual([1, 2, 3, 4]);
    expect(restoredState.events.map(({ id }) => id)).toEqual([10, 11]);
    expect(restoredState.newsletters[0]).toMatchObject({
      id: 20,
      storyCount: 2,
      itemIds: [1, 2],
    });
  });

  test("keeps members standalone while event importance is pending", async () => {
    const client = await database();
    await seedPublicData(client);
    const source = new LibsqlPublicContentSource(client, { now: () => NOW });
    const initial = await source.readBatch(0);
    const firstState = patchCanonicalPublicState(
      EMPTY_STATE,
      initial.changes,
    ).state;

    await client.batch(
      [
        `UPDATE clusters SET importance = NULL WHERE id = 10`,
        `INSERT INTO public_content_outbox (entity_type, entity_key)
         VALUES ('event', '10')`,
      ],
      "write",
    );
    const pending = await source.readBatch(initial.toWatermark);
    const pendingState = patchCanonicalPublicState(
      firstState,
      pending.changes,
    ).state;

    expect(
      pending.changes.find(
        (change) =>
          change.entityType === "event" && change.entityKey === "10",
      )?.value,
    ).toBeNull();
    expect(
      pendingState.items
        .filter(({ id }) => id === 1 || id === 2)
        .map(({ eventId }) => eventId),
    ).toEqual([null, null]);
    expect(pendingState.events.map(({ id }) => id)).toEqual([11]);
  });

  test("replaces a policy by logical key instead of accumulating versions", async () => {
    const client = await database();
    await seedPublicData(client);
    const source = new LibsqlPublicContentSource(client, { now: () => NOW });
    const initial = await source.readBatch(0);
    const firstState = patchCanonicalPublicState(
      EMPTY_STATE,
      initial.changes,
    ).state;

    await client.batch(
      [
        `INSERT INTO policy_versions (id, skill_name, version, committed_at)
         VALUES (3, 'editorial', 3, ${NOW + 1_000})`,
        `INSERT INTO public_content_outbox (entity_type, entity_key)
         VALUES ('policy', 'editorial')`,
      ],
      "write",
    );
    const changed = await source.readBatch(initial.toWatermark);
    const next = patchCanonicalPublicState(firstState, changed.changes).state;
    expect(next.policies.map(({ version }) => version)).toEqual(["v3"]);
  });

  test("closes item mutations over their current event even when its outbox row is later", async () => {
    const client = await database();
    await seedPublicData(client);
    const source = new LibsqlPublicContentSource(client, { now: () => NOW });

    await client.execute("DELETE FROM public_content_outbox");
    await client.execute(
      "INSERT INTO public_content_outbox (entity_type, entity_key) VALUES ('item', '1')",
    );

    const batch = await source.readBatch(0);
    expect(
      batch.changes.some(
        (change) =>
          change.entityType === "event" &&
          change.entityKey === "10" &&
          change.value !== null,
      ),
    ).toBe(true);
    expect(
      batch.changes
        .filter(
          (change) =>
            change.entityType === "item" &&
            change.value?.eventId === 10,
        )
        .map((change) => Number(change.entityKey))
        .sort((left, right) => left - right),
    ).toEqual([1, 2]);
  });

  test("closes newsletter mutations over referenced public items", async () => {
    const client = await database();
    await seedPublicData(client);
    const source = new LibsqlPublicContentSource(client, {
      now: () => NOW,
    });
    const initial = await source.readBatch(0);
    const initialState = patchCanonicalPublicState(
      EMPTY_STATE,
      initial.changes,
    ).state;
    const previousState = {
      ...initialState,
      items: [],
      events: [],
      newsletters: [],
    };
    await client.execute(
      `INSERT INTO public_content_outbox (entity_type, entity_key)
       VALUES ('newsletter', '20')`,
    );

    const batch = await source.readBatch(initial.toWatermark);
    const next = patchCanonicalPublicState(previousState, batch.changes).state;

    expect(batch.telemetry.candidateRows).toBe(1);
    expect(
      batch.changes
        .filter((change) => change.entityType === "item" && change.value)
        .map((change) => Number(change.entityKey))
        .sort((left, right) => left - right),
    ).toEqual([1, 2]);
    expect(next.items.map(({ id }) => id)).toEqual([1, 2]);
    expect(next.events.map(({ id }) => id)).toEqual([10]);
    expect(next.newsletters[0]).toMatchObject({
      id: 20,
      storyCount: 2,
      itemIds: [1, 2],
    });
  });

  test("closes newsletter-driven event refreshes over former members beyond the page boundary", async () => {
    const client = await database();
    await seedPublicData(client);
    const source = new LibsqlPublicContentSource(client, { now: () => NOW });
    const initial = await source.readBatch(0);
    const previousState = patchCanonicalPublicState(
      EMPTY_STATE,
      initial.changes,
    ).state;

    await client.batch(
      [
        `UPDATE newsletters
         SET story_count = 1, item_ids = '[2]'
         WHERE id = 20`,
        `UPDATE items SET cluster_id = 11 WHERE id = 1`,
        `UPDATE clusters
         SET lead_item_id = 2, member_count = 1, coverage = 1
         WHERE id = 10`,
        `UPDATE clusters
         SET member_count = 3, coverage = 3
         WHERE id = 11`,
        `DELETE FROM public_content_outbox`,
        `INSERT INTO public_content_outbox
         (entity_type, entity_key, created_at)
         VALUES ('newsletter', '20', ${NOW - 1}),
                ('item', '1', ${NOW}),
                ('event', '10', ${NOW})`,
      ],
      "write",
    );

    const batch = await new LibsqlPublicContentSource(client, {
      now: () => NOW,
      caps: { maxOutboxRows: 1 },
    }).readBatch(0);
    const next = patchCanonicalPublicState(previousState, batch.changes).state;

    expect(batch.telemetry.candidateRows).toBe(1);
    expect(
      batch.changes.find(
        (change) =>
          change.entityType === "event" && change.entityKey === "10",
      )?.value,
    ).toBeNull();
    expect(
      batch.changes.find(
        (change) =>
          change.entityType === "event" && change.entityKey === "11",
      )?.value,
    ).toMatchObject({ memberItemIds: [1, 3, 4] });
    expect(
      next.items.find(({ id }) => id === 1),
    ).toMatchObject({ eventId: 11 });
    expect(
      next.items.find(({ id }) => id === 2),
    ).toMatchObject({ eventId: null });
    expect(next.newsletters[0]).toMatchObject({
      id: 20,
      storyCount: 1,
      itemIds: [2],
    });
  });

  test("closes a page-boundary item move over its old and new events", async () => {
    const client = await database();
    await seedPublicData(client);
    await client.batch(
      [
        `UPDATE items SET cluster_id = 11 WHERE id = 1`,
        `UPDATE clusters
         SET lead_item_id = 2, member_count = 1, coverage = 1
         WHERE id = 10`,
        `UPDATE clusters
         SET member_count = 3, coverage = 3
         WHERE id = 11`,
        `DELETE FROM public_content_outbox`,
        `INSERT INTO public_content_outbox
         (entity_type, entity_key, created_at)
         VALUES ('item', '1', ${NOW}),
                ('event', '10', ${NOW})`,
      ],
      "write",
    );

    const batch = await new LibsqlPublicContentSource(client, {
      now: () => NOW,
      caps: { maxOutboxRows: 1 },
    }).readBatch(0);

    expect(batch.telemetry.candidateRows).toBe(1);
    expect(
      batch.changes.find(
        (change) =>
          change.entityType === "event" && change.entityKey === "10",
      )?.value,
    ).toBeNull();
    expect(
      batch.changes.find(
        (change) =>
          change.entityType === "event" && change.entityKey === "11",
      )?.value,
    ).toMatchObject({ memberItemIds: [1, 3, 4] });
    expect(
      batch.changes.find(
        (change) =>
          change.entityType === "item" && change.entityKey === "2",
      )?.value,
    ).toMatchObject({ eventId: null });
    expect(
      batch.changes.find(
        (change) =>
          change.entityType === "item" && change.entityKey === "1",
      )?.value,
    ).toMatchObject({ eventId: 11 });
  });

  test("pages through an outbox backlog while preserving hard caps", async () => {
    const client = await database();
    await seedPublicData(client);

    expect(
      () =>
        new LibsqlPublicContentSource(client, {
          caps: { maxEntityKeys: 501 },
        }),
    ).toThrow(/cannot exceed hard limit 500/);

    const paged = new LibsqlPublicContentSource(client, {
      caps: { maxOutboxRows: 1 },
    });
    const first = await paged.readBatch(0);
    expect(first).toMatchObject({
      fromWatermark: 0,
      toWatermark: 1,
      telemetry: { candidateRows: 1, dedupedEntities: 1 },
    });
    const second = await paged.readBatch(first.toWatermark);
    expect(second).toMatchObject({
      fromWatermark: 1,
      toWatermark: 2,
      telemetry: { candidateRows: 1, dedupedEntities: 1 },
    });

    await expect(
      new LibsqlPublicContentSource(client, {
        caps: { maxOutboxRows: 10, maxDependentRows: 1 },
      }).readBatch(0),
    ).rejects.toMatchObject({
      name: "PublisherSourceLimitError",
      dimension: "maxDependentRows",
      limit: 1,
    });
  });
});
