import type { Client, InValue, Row } from "@libsql/client";
import {
  canonicalStateSchema,
  publicEventSchema,
  publicItemSchema,
  publicNewsletterSchema,
  publicPolicySchema,
  publicSourceSchema,
  type CanonicalPublicState,
} from "@/lib/public-content/contracts";
import {
  isEligiblePublicEvent,
  isEligiblePublicItem,
} from "@/lib/public-content/eligibility";
import { isVisibleItemTier } from "@/lib/types";
import { patchCanonicalPublicState } from "./patch-state";
import {
  DEFAULT_PUBLISHER_SOURCE_CAPS,
  PUBLIC_ENTITY_TYPES,
  PublisherSourceLimitError,
  type PublicContentPublisherSource,
  type PublicEntityChange,
  type PublicEntityType,
  type PublisherSourceBatch,
  type PublisherSourceCaps,
} from "./types";

const DAY_MS = 86_400_000;

export const PUBLISHER_SOURCE_VERIFIED_PLANS = [
  "public_content_outbox:integer-primary-key-range",
  "items:integer-primary-key",
  "clusters:integer-primary-key",
  "items:items_cluster_idx",
  "sources:primary-key",
  "items:items_source_idx",
  "newsletters:integer-primary-key",
  "policy_versions:policy_versions_latest_idx",
] as const;

const EMPTY_CANONICAL_STATE = canonicalStateSchema.parse({
  schemaVersion: 1,
  items: [],
  events: [],
  sources: [],
  newsletters: [],
  policies: [],
});

const ITEM_SELECT = `
  i.id, i.source_id, i.cluster_id,
  i.title, i.title_zh, i.title_en,
  i.summary_zh, i.summary_en,
  i.editor_note_zh, i.editor_note_en,
  i.editor_analysis_zh, i.editor_analysis_en,
  i.body_md, i.author, i.url, i.canonical_url, i.tags,
  i.importance, i.tier, i.hkr, i.published_at, i.created_at,
  i.enriched_at, i.commentary_at,
  c.member_count AS cluster_member_count,
  c.no_content AS cluster_no_content,
  c.importance AS cluster_importance,
  c.event_tier AS cluster_event_tier`;

type OutboxMutation = {
  id: number;
  entityType: PublicEntityType;
  entityKey: string;
};

export class LibsqlPublicContentSource implements PublicContentPublisherSource {
  readonly #caps: PublisherSourceCaps;
  readonly #now: () => number;

  constructor(
    readonly client: Client,
    options: {
      caps?: Partial<PublisherSourceCaps>;
      now?: () => number;
    } = {},
  ) {
    this.#caps = validateCaps({
      ...DEFAULT_PUBLISHER_SOURCE_CAPS,
      ...options.caps,
    });
    this.#now = options.now ?? Date.now;
  }

  async readBatch(fromWatermark: number): Promise<PublisherSourceBatch> {
    assertWatermark(fromWatermark);
    let queryCount = 0;
    let returnedRows = 0;
    let scannedRows = 0;
    const execute = async (sql: string, args: readonly InValue[] = []) => {
      queryCount += 1;
      return this.client.execute({ sql, args: [...args] });
    };

    const maximum = await execute(
      "SELECT COALESCE(MAX(id), 0) AS high_water FROM public_content_outbox",
    );
    const toWatermark = Math.max(
      fromWatermark,
      numeric(maximum.rows[0]?.high_water, "outbox high water"),
    );
    if (toWatermark === fromWatermark) {
      return sourceBatch({
        fromWatermark,
        toWatermark,
        changes: [],
        candidateRows: 0,
        dedupedEntities: 0,
        returnedRows,
        scannedRows,
        queryCount,
      });
    }

    const outboxRows = await execute(
      `SELECT id, entity_type, entity_key
       FROM public_content_outbox
       WHERE id > ? AND id <= ?
       ORDER BY id
       LIMIT ?`,
      [fromWatermark, toWatermark, this.#caps.maxOutboxRows + 1],
    );
    if (outboxRows.rows.length > this.#caps.maxOutboxRows) {
      throw new PublisherSourceLimitError(
        "maxOutboxRows",
        outboxRows.rows.length,
        this.#caps.maxOutboxRows,
      );
    }
    const candidates = outboxRows.rows.map(parseOutboxMutation);
    scannedRows += candidates.length;
    const mutations = dedupeMutations(candidates);
    if (mutations.length > this.#caps.maxEntityKeys) {
      throw new PublisherSourceLimitError(
        "maxEntityKeys",
        mutations.length,
        this.#caps.maxEntityKeys,
      );
    }

    const byType = groupMutations(mutations);
    const changes = new Map<string, PublicEntityChange>();
    for (const mutation of mutations) {
      changes.set(changeId(mutation.entityType, mutation.entityKey), {
        entityType: mutation.entityType,
        entityKey: mutation.entityKey,
        value: null,
      } as PublicEntityChange);
    }

    const itemKeys = numericKeys(byType.item, "item");
    if (itemKeys.length > 0) {
      const result = await execute(
        `SELECT ${ITEM_SELECT}
         FROM items i
         LEFT JOIN clusters c ON c.id = i.cluster_id
         WHERE i.id IN (${placeholders(itemKeys.length)})`,
        itemKeys,
      );
      returnedRows += result.rows.length;
      scannedRows += itemKeys.length;
      for (const row of result.rows) setItemChange(changes, row);
    }

    const eventKeys = numericKeys(byType.event, "event");
    let eventRows: Row[] = [];
    let memberRows: Row[] = [];
    if (eventKeys.length > 0) {
      const result = await execute(
        `SELECT id, lead_item_id, member_count, coverage,
                first_seen_at, latest_member_at,
                canonical_title_zh, canonical_title_en,
                editor_note_zh, editor_note_en,
                editor_analysis_zh, editor_analysis_en,
                importance, event_tier, hkr, no_content
         FROM clusters WHERE id IN (${placeholders(eventKeys.length)})`,
        eventKeys,
      );
      eventRows = result.rows;
      returnedRows += result.rows.length;
      scannedRows += eventKeys.length;

      const members = await execute(
        `SELECT ${ITEM_SELECT}
         FROM items i INDEXED BY items_cluster_idx
         LEFT JOIN clusters c ON c.id = i.cluster_id
         WHERE i.cluster_id IN (${placeholders(eventKeys.length)})
         ORDER BY i.cluster_id, i.id
         LIMIT ?`,
        [...eventKeys, this.#caps.maxDependentRows + 1],
      );
      if (members.rows.length > this.#caps.maxDependentRows) {
        throw new PublisherSourceLimitError(
          "maxDependentRows",
          members.rows.length,
          this.#caps.maxDependentRows,
        );
      }
      memberRows = members.rows;
      returnedRows += memberRows.length;
      scannedRows += memberRows.length;
      for (const row of memberRows) setItemChange(changes, row);
      setEventChanges(changes, eventRows, memberRows);
    }

    const sourceKeys = stringKeys(byType.source);
    if (sourceKeys.length > 0) {
      const result = await execute(
        `SELECT s.id, s.name_en, s.name_zh, s.url, s.kind, s."group",
                s.locale, s.cadence, s.priority, s.tags, s.enabled, s.curated,
                h.status, h.last_success_at, h.consecutive_failures,
                h.total_items_count
         FROM sources s
         LEFT JOIN source_health h ON h.source_id = s.id
         WHERE s.id IN (${placeholders(sourceKeys.length)})`,
        sourceKeys,
      );
      returnedRows += result.rows.length;
      scannedRows += sourceKeys.length;

      const recent = await execute(
        `SELECT source_id
         FROM items INDEXED BY items_source_idx
         WHERE source_id IN (${placeholders(sourceKeys.length)})
           AND published_at >= ?
         LIMIT ?`,
        [
          ...sourceKeys,
          this.#now() - DAY_MS,
          this.#caps.maxDependentRows + 1,
        ],
      );
      if (recent.rows.length > this.#caps.maxDependentRows) {
        throw new PublisherSourceLimitError(
          "maxDependentRows",
          recent.rows.length,
          this.#caps.maxDependentRows,
        );
      }
      returnedRows += recent.rows.length;
      scannedRows += recent.rows.length;
      const recentCounts = countBy(recent.rows, "source_id");
      for (const row of result.rows) {
        const value = publicSourceFromRow(
          row,
          recentCounts.get(text(row.id, "source id")) ?? 0,
        );
        changes.set(changeId("source", value.id), {
          entityType: "source",
          entityKey: value.id,
          value,
        });
      }
    }

    const newsletterKeys = numericKeys(byType.newsletter, "newsletter");
    if (newsletterKeys.length > 0) {
      const result = await execute(
        `SELECT id, kind, locale, period_start, period_end, published_at,
                story_count, item_ids, headline, overview, highlights,
                commentary, column_title, column_theme_tag, column_summary_md,
                column_narrative_md, column_featured_item_ids
         FROM newsletters WHERE id IN (${placeholders(newsletterKeys.length)})`,
        newsletterKeys,
      );
      returnedRows += result.rows.length;
      scannedRows += newsletterKeys.length;
      for (const row of result.rows) {
        const value = publicNewsletterFromRow(row);
        changes.set(changeId("newsletter", String(value.id)), {
          entityType: "newsletter",
          entityKey: String(value.id),
          value,
        });
      }
    }

    const policyKeys = stringKeys(byType.policy);
    if (policyKeys.length > 0) {
      const result = await execute(
        `SELECT skill_name, version, committed_at
         FROM policy_versions INDEXED BY policy_versions_latest_idx
         WHERE skill_name IN (${placeholders(policyKeys.length)})
         ORDER BY skill_name, committed_at DESC
         LIMIT ?`,
        [...policyKeys, this.#caps.maxDependentRows + 1],
      );
      if (result.rows.length > this.#caps.maxDependentRows) {
        throw new PublisherSourceLimitError(
          "maxDependentRows",
          result.rows.length,
          this.#caps.maxDependentRows,
        );
      }
      returnedRows += result.rows.length;
      scannedRows += result.rows.length;
      const seen = new Set<string>();
      for (const row of result.rows) {
        const key = text(row.skill_name, "policy skill");
        if (seen.has(key)) continue;
        seen.add(key);
        const value = publicPolicyFromRow(row);
        changes.set(changeId("policy", key), {
          entityType: "policy",
          entityKey: key,
          value,
        });
      }
    }

    return sourceBatch({
      fromWatermark,
      toWatermark,
      changes: [...changes.values()],
      candidateRows: candidates.length,
      dedupedEntities: mutations.length,
      returnedRows,
      scannedRows,
      queryCount,
    });
  }

  async acknowledgeThrough(highWater: number): Promise<void> {
    assertWatermark(highWater);
    await this.client.execute({
      sql: "DELETE FROM public_content_outbox WHERE id <= ?",
      args: [highWater],
    });
  }
}

export async function verifyPublisherSourcePlans(client: Client): Promise<string[]> {
  const checks = [
    [
      "public_content_outbox:integer-primary-key-range",
      "SELECT id FROM public_content_outbox WHERE id > 0 AND id <= 1 ORDER BY id",
      /INTEGER PRIMARY KEY|rowid/i,
    ],
    ["items:integer-primary-key", "SELECT id FROM items WHERE id = 1", /INTEGER PRIMARY KEY|rowid/i],
    ["clusters:integer-primary-key", "SELECT id FROM clusters WHERE id = 1", /INTEGER PRIMARY KEY|rowid/i],
    [
      "items:items_cluster_idx",
      "SELECT id FROM items INDEXED BY items_cluster_idx WHERE cluster_id = 1 ORDER BY published_at",
      /items_cluster_idx/,
    ],
    ["sources:primary-key", "SELECT id FROM sources WHERE id = 'x'", /sqlite_autoindex_sources_1|PRIMARY KEY/i],
    [
      "items:items_source_idx",
      "SELECT source_id FROM items INDEXED BY items_source_idx WHERE source_id = 'x' AND published_at >= 0",
      /items_source_idx/,
    ],
    ["newsletters:integer-primary-key", "SELECT id FROM newsletters WHERE id = 1", /INTEGER PRIMARY KEY|rowid/i],
    [
      "policy_versions:policy_versions_latest_idx",
      "SELECT version FROM policy_versions INDEXED BY policy_versions_latest_idx WHERE skill_name = 'editorial' ORDER BY committed_at DESC",
      /policy_versions_latest_idx/,
    ],
  ] as const;
  for (const [name, sql, pattern] of checks) {
    const result = await client.execute(`EXPLAIN QUERY PLAN ${sql}`);
    const detail = result.rows.map((row) => String(row.detail ?? "")).join("\n");
    if (!pattern.test(detail)) throw new Error(`publisher source plan failed: ${name}: ${detail}`);
  }
  return [...PUBLISHER_SOURCE_VERIFIED_PLANS];
}

export type PublicBootstrapExport = {
  state: CanonicalPublicState;
  sourceWatermark: number;
  telemetry: {
    queryCount: number;
    returnedRows: number;
  };
};

/**
 * One-shot, operator-only full export for the first snapshot. The outbox high
 * water is captured before paging, so any concurrent write is either reflected
 * in the export or replayed by the incremental publisher after bootstrap.
 */
export async function exportCanonicalPublicState(
  client: Client,
  options: { now?: () => number; pageSize?: number } = {},
): Promise<PublicBootstrapExport> {
  const now = options.now ?? Date.now;
  const pageSize = options.pageSize ?? 250;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 500) {
    throw new RangeError("bootstrap export pageSize must be 1..500");
  }

  let queryCount = 0;
  let returnedRows = 0;
  const execute = async (sql: string, args: readonly InValue[] = []) => {
    queryCount += 1;
    const result = await client.execute({ sql, args: [...args] });
    returnedRows += result.rows.length;
    return result;
  };

  const watermarkResult = await execute(
    "SELECT COALESCE(MAX(id), 0) AS high_water FROM public_content_outbox",
  );
  const sourceWatermark = numeric(
    watermarkResult.rows[0]?.high_water,
    "bootstrap outbox high water",
  );

  const recentResult = await execute(
    `SELECT source_id, COUNT(*) AS recent_count
     FROM items INDEXED BY items_source_idx
     WHERE published_at >= ?
     GROUP BY source_id`,
    [now() - DAY_MS],
  );
  const recentCounts = new Map(
    recentResult.rows.map((row) => [
      text(row.source_id, "source recent id"),
      numeric(row.recent_count, "source recent count"),
    ]),
  );
  const sourceRows = (
    await execute(
      `SELECT s.id, s.name_en, s.name_zh, s.url, s.kind, s."group",
              s.locale, s.cadence, s.priority, s.tags, s.enabled, s.curated,
              h.status, h.last_success_at, h.consecutive_failures,
              h.total_items_count
       FROM sources s
       LEFT JOIN source_health h ON h.source_id = s.id
       ORDER BY s.id`,
    )
  ).rows;

  const itemRows = await readNumericPages(
    execute,
    `SELECT ${ITEM_SELECT}
     FROM items i
     LEFT JOIN clusters c ON c.id = i.cluster_id
     WHERE i.id > ?
     ORDER BY i.id
     LIMIT ?`,
    pageSize,
  );
  const eventRows = await readNumericPages(
    execute,
    `SELECT id, lead_item_id, member_count, coverage,
            first_seen_at, latest_member_at,
            canonical_title_zh, canonical_title_en,
            editor_note_zh, editor_note_en,
            editor_analysis_zh, editor_analysis_en,
            importance, event_tier, hkr, no_content
     FROM clusters
     WHERE id > ?
     ORDER BY id
     LIMIT ?`,
    pageSize,
  );
  const newsletterRows = await readNumericPages(
    execute,
    `SELECT id, kind, locale, period_start, period_end, published_at,
            story_count, item_ids, headline, overview, highlights,
            commentary, column_title, column_theme_tag, column_summary_md,
            column_narrative_md, column_featured_item_ids
     FROM newsletters
     WHERE id > ?
     ORDER BY id
     LIMIT ?`,
    pageSize,
  );
  const policyRows = (
    await execute(
      `SELECT skill_name, version, committed_at
       FROM policy_versions INDEXED BY policy_versions_latest_idx
       WHERE skill_name = 'editorial'
       ORDER BY committed_at DESC
       LIMIT 1`,
    )
  ).rows;

  const changes: PublicEntityChange[] = [];
  for (const row of sourceRows) {
    const key = text(row.id, "source id");
    changes.push({
      entityType: "source",
      entityKey: key,
      value: publicSourceFromRow(row, recentCounts.get(key) ?? 0),
    });
  }
  for (const row of itemRows) {
    const value = publicItemFromRow(row);
    if (value) {
      changes.push({
        entityType: "item",
        entityKey: String(value.id),
        value,
      });
    }
  }
  const membersByEvent = new Map<number, Row[]>();
  for (const row of itemRows) {
    const eventId = nullableNumeric(row.cluster_id, "member event id");
    if (eventId === null) continue;
    const members = membersByEvent.get(eventId) ?? [];
    members.push(row);
    membersByEvent.set(eventId, members);
  }
  for (const row of eventRows) {
    const eventId = numeric(row.id, "event id");
    const value = publicEventFromRows(row, membersByEvent.get(eventId) ?? []);
    if (value) {
      changes.push({
        entityType: "event",
        entityKey: String(value.id),
        value,
      });
    }
  }
  for (const row of newsletterRows) {
    const value = publicNewsletterFromRow(row);
    changes.push({
      entityType: "newsletter",
      entityKey: String(value.id),
      value,
    });
  }
  for (const row of policyRows) {
    const value = publicPolicyFromRow(row);
    changes.push({
      entityType: "policy",
      entityKey: value.skillName,
      value,
    });
  }

  return {
    state: patchCanonicalPublicState(EMPTY_CANONICAL_STATE, changes).state,
    sourceWatermark,
    telemetry: { queryCount, returnedRows },
  };
}

async function readNumericPages(
  execute: (
    sql: string,
    args?: readonly InValue[],
  ) => Promise<Awaited<ReturnType<Client["execute"]>>>,
  sql: string,
  pageSize: number,
): Promise<Row[]> {
  const rows: Row[] = [];
  let cursor = 0;
  for (;;) {
    const page = await execute(sql, [cursor, pageSize]);
    rows.push(...page.rows);
    if (page.rows.length < pageSize) return rows;
    const nextCursor = numeric(page.rows.at(-1)?.id, "bootstrap page cursor");
    if (nextCursor <= cursor) throw new Error("bootstrap page cursor did not advance");
    cursor = nextCursor;
  }
}

function sourceBatch(args: {
  fromWatermark: number;
  toWatermark: number;
  changes: PublicEntityChange[];
  candidateRows: number;
  dedupedEntities: number;
  returnedRows: number;
  scannedRows: number;
  queryCount: number;
}): PublisherSourceBatch {
  return {
    fromWatermark: args.fromWatermark,
    toWatermark: args.toWatermark,
    changes: args.changes,
    telemetry: {
      candidateRows: args.candidateRows,
      dedupedEntities: args.dedupedEntities,
      returnedRows: args.returnedRows,
      scannedRows: Math.max(
        args.scannedRows,
        args.candidateRows,
        args.returnedRows,
      ),
      scanMeasurementKind: "plan_upper_bound",
      queryCount: args.queryCount,
      verifiedPlans: [...PUBLISHER_SOURCE_VERIFIED_PLANS],
    },
  };
}

function parseOutboxMutation(row: Row): OutboxMutation {
  const entityType = text(row.entity_type, "outbox entity type");
  if (!(PUBLIC_ENTITY_TYPES as readonly string[]).includes(entityType)) {
    throw new Error(`unknown public outbox entity type: ${entityType}`);
  }
  const entityKey = text(row.entity_key, "outbox entity key");
  if (entityKey.length === 0) throw new Error("empty public outbox entity key");
  return {
    id: numeric(row.id, "outbox id"),
    entityType: entityType as PublicEntityType,
    entityKey,
  };
}

function dedupeMutations(rows: readonly OutboxMutation[]): OutboxMutation[] {
  const deduped = new Map<string, OutboxMutation>();
  for (const row of rows) deduped.set(changeId(row.entityType, row.entityKey), row);
  return [...deduped.values()];
}

function groupMutations(rows: readonly OutboxMutation[]): Record<PublicEntityType, string[]> {
  const grouped = Object.fromEntries(
    PUBLIC_ENTITY_TYPES.map((type) => [type, [] as string[]]),
  ) as Record<PublicEntityType, string[]>;
  for (const row of rows) grouped[row.entityType].push(row.entityKey);
  return grouped;
}

function setItemChange(changes: Map<string, PublicEntityChange>, row: Row): void {
  const id = numeric(row.id, "item id");
  changes.set(changeId("item", String(id)), {
    entityType: "item",
    entityKey: String(id),
    value: publicItemFromRow(row),
  });
}

function setEventChanges(
  changes: Map<string, PublicEntityChange>,
  events: readonly Row[],
  members: readonly Row[],
): void {
  const membersByEvent = new Map<number, Row[]>();
  for (const member of members) {
    const eventId = nullableNumeric(member.cluster_id, "member event id");
    if (eventId === null) continue;
    const rows = membersByEvent.get(eventId) ?? [];
    rows.push(member);
    membersByEvent.set(eventId, rows);
  }
  for (const row of events) {
    const id = numeric(row.id, "event id");
    changes.set(changeId("event", String(id)), {
      entityType: "event",
      entityKey: String(id),
      value: publicEventFromRows(row, membersByEvent.get(id) ?? []),
    });
  }
}

function publicItemFromRow(row: Row) {
  const id = numeric(row.id, "item id");
  const enrichedAt = nullableNumeric(row.enriched_at, "item enriched_at");
  const importance = nullableNumeric(row.importance, "item importance");
  const tier = nullableText(row.tier, "item tier");
  if (
    !isEligiblePublicItem({
      id,
      enrichedAt: enrichedAt === null ? null : iso(enrichedAt),
      importance,
      tier,
      intendedPublic: true,
    })
  ) {
    return null;
  }
  const clusterId = publicEventIdForItem(row, tier!);
  return publicItemSchema.parse({
    schemaVersion: 1,
    id,
    sourceId: text(row.source_id, "item source"),
    eventId: clusterId,
    title: {
      raw: text(row.title, "item title"),
      zh: nullableText(row.title_zh, "item title zh"),
      en: nullableText(row.title_en, "item title en"),
    },
    summary: {
      zh: nullableText(row.summary_zh, "item summary zh"),
      en: nullableText(row.summary_en, "item summary en"),
    },
    editorNote: {
      zh: nullableText(row.editor_note_zh, "item note zh"),
      en: nullableText(row.editor_note_en, "item note en"),
    },
    editorAnalysis: {
      zh: nullableText(row.editor_analysis_zh, "item analysis zh"),
      en: nullableText(row.editor_analysis_en, "item analysis en"),
    },
    bodyMd: nullableText(row.body_md, "item body md"),
    author: nullableText(row.author, "item author"),
    url: text(row.url, "item url"),
    canonicalUrl: text(row.canonical_url, "item canonical url"),
    tags: tags(row.tags),
    importance,
    tier,
    hkr: hkr(row.hkr),
    publishedAt: iso(numeric(row.published_at, "item published_at")),
    createdAt: iso(numeric(row.created_at, "item created_at")),
    enrichedAt: iso(enrichedAt!),
    commentaryAt: timestamp(row.commentary_at, "item commentary_at"),
  });
}

function publicEventFromRows(row: Row, memberRows: readonly Row[]) {
  const id = numeric(row.id, "event id");
  const members = memberRows.map((member) => ({
    id: numeric(member.id, "event member id"),
    enrichedAt: timestamp(member.enriched_at, "member enriched_at"),
    importance: nullableNumeric(member.importance, "member importance"),
    tier: nullableText(member.tier, "member tier"),
    intendedPublic: true,
  }));
  const leadItemId = numeric(row.lead_item_id, "event lead id");
  const lead = members.find((member) => member.id === leadItemId);
  const tier = nullableText(row.event_tier, "event tier") ?? lead?.tier ?? null;
  if (
    !isEligiblePublicEvent(
      {
        leadItemId,
        memberItemIds: members.map((member) => member.id),
        noContent: numeric(row.no_content, "event no_content") !== 0,
        tier,
      },
      members,
    )
  ) {
    return null;
  }
  const coverage = numeric(row.coverage, "event coverage");
  const memberCount = numeric(row.member_count, "event member_count");
  if (coverage !== members.length || memberCount !== members.length) {
    throw new Error(`event membership drift for ${id}`);
  }
  return publicEventSchema.parse({
    schemaVersion: 1,
    id,
    leadItemId,
    memberItemIds: members.map((member) => member.id),
    coverage,
    firstSeenAt: iso(numeric(row.first_seen_at, "event first_seen_at")),
    latestMemberAt: timestamp(row.latest_member_at, "event latest_member_at"),
    canonicalTitle: {
      zh: nullableText(row.canonical_title_zh, "event title zh"),
      en: nullableText(row.canonical_title_en, "event title en"),
    },
    editorNote: {
      zh: nullableText(row.editor_note_zh, "event note zh"),
      en: nullableText(row.editor_note_en, "event note en"),
    },
    editorAnalysis: {
      zh: nullableText(row.editor_analysis_zh, "event analysis zh"),
      en: nullableText(row.editor_analysis_en, "event analysis en"),
    },
    importance: numeric(row.importance, "event importance"),
    tier,
    hkr: hkr(row.hkr),
  });
}

function publicEventIdForItem(row: Row, itemTier: string): number | null {
  const id = nullableNumeric(row.cluster_id, "item cluster id");
  if (id === null) return null;
  const memberCount = nullableNumeric(
    row.cluster_member_count,
    "cluster member count",
  );
  const noContent = nullableNumeric(row.cluster_no_content, "cluster no_content");
  const importance = nullableNumeric(
    row.cluster_importance,
    "cluster importance",
  );
  const tier = nullableText(row.cluster_event_tier, "cluster tier") ?? itemTier;
  return memberCount !== null &&
    memberCount >= 2 &&
    noContent === 0 &&
    importance !== null &&
    isVisibleItemTier(tier)
    ? id
    : null;
}

function publicSourceFromRow(row: Row, last24h: number) {
  const total = nullableNumeric(row.total_items_count, "source total") ?? 0;
  return publicSourceSchema.parse({
    schemaVersion: 1,
    id: text(row.id, "source id"),
    name: {
      zh: text(row.name_zh, "source name zh"),
      en: text(row.name_en, "source name en"),
    },
    url: text(row.url, "source url"),
    kind: text(row.kind, "source kind"),
    group: text(row.group, "source group"),
    locale: text(row.locale, "source locale"),
    cadence: text(row.cadence, "source cadence"),
    priority: numeric(row.priority, "source priority"),
    tags: stringArray(row.tags, "source tags"),
    enabled: booleanValue(row.enabled, "source enabled"),
    curated: booleanValue(row.curated, "source curated"),
    health: {
      status: nullableText(row.status, "source status") ?? "pending",
      lastSuccessAt: timestamp(row.last_success_at, "source last_success_at"),
      consecutiveFailures:
        nullableNumeric(row.consecutive_failures, "source failures") ?? 0,
      totalItemsCount: total,
    },
    itemCounts: { allTime: total, last24h },
  });
}

function publicNewsletterFromRow(row: Row) {
  const common = {
    schemaVersion: 1 as const,
    id: numeric(row.id, "newsletter id"),
    kind: text(row.kind, "newsletter kind"),
    locale: text(row.locale, "newsletter locale"),
    periodStart: iso(numeric(row.period_start, "newsletter period_start")),
    periodEnd: iso(numeric(row.period_end, "newsletter period_end")),
    publishedAt: iso(numeric(row.published_at, "newsletter published_at")),
    storyCount: numeric(row.story_count, "newsletter story_count"),
    itemIds: numberArray(row.item_ids, "newsletter item_ids"),
  };
  const title = nullableText(row.column_title, "newsletter column title");
  return publicNewsletterSchema.parse(
    title !== null
      ? {
          ...common,
          format: "daily_column",
          title,
          themeTag: nullableText(row.column_theme_tag, "newsletter theme"),
          summaryMd: nullableText(row.column_summary_md, "newsletter summary"),
          narrativeMd: nullableText(
            row.column_narrative_md,
            "newsletter narrative",
          ),
          featuredItemIds: numberArray(
            row.column_featured_item_ids,
            "newsletter featured ids",
          ),
        }
      : {
          ...common,
          format: "structured",
          headline: nullableText(row.headline, "newsletter headline"),
          overview: nullableText(row.overview, "newsletter overview"),
          highlights: nullableText(row.highlights, "newsletter highlights"),
          commentary: nullableText(row.commentary, "newsletter commentary"),
        },
  );
}

function publicPolicyFromRow(row: Row) {
  return publicPolicySchema.parse({
    schemaVersion: 1,
    skillName: text(row.skill_name, "policy skill"),
    version: `v${numeric(row.version, "policy version")}`,
    committedAt: iso(numeric(row.committed_at, "policy committed_at")),
  });
}

function tags(value: unknown) {
  const parsed = json(value, "item tags");
  return {
    capabilities: stringArray(parsed.capabilities, "item capability tags"),
    entities: stringArray(parsed.entities, "item entity tags"),
    topics: stringArray(parsed.topics, "item topic tags"),
  };
}

function hkr(value: unknown) {
  if (value === null || value === undefined) return null;
  const parsed = json(value, "hkr");
  return {
    h: booleanValue(parsed.h, "hkr.h"),
    k: booleanValue(parsed.k, "hkr.k"),
    r: booleanValue(parsed.r, "hkr.r"),
  };
}

function json(value: unknown, label: string): Record<string, unknown> {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`invalid ${label}`);
  }
  return parsed as Record<string, unknown>;
}

function stringArray(value: unknown, label: string): string[] {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
    throw new Error(`invalid ${label}`);
  }
  return parsed;
}

function numberArray(value: unknown, label: string): number[] {
  if (value === null || value === undefined) return [];
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (
    !Array.isArray(parsed) ||
    parsed.some((entry) => !Number.isSafeInteger(entry) || entry <= 0)
  ) {
    throw new Error(`invalid ${label}`);
  }
  return parsed;
}

function countBy(rows: readonly Row[], field: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = text(row[field], field);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function numericKeys(values: readonly string[], label: string): number[] {
  return values.map((value) => {
    if (!/^[1-9]\d*$/.test(value)) throw new Error(`invalid ${label} key: ${value}`);
    return numeric(Number(value), `${label} key`);
  });
}

function stringKeys(values: readonly string[]): string[] {
  return [...values];
}

function placeholders(count: number): string {
  if (count < 1) throw new Error("empty SQL key set");
  return Array.from({ length: count }, () => "?").join(", ");
}

function changeId(type: PublicEntityType, key: string): string {
  return `${type}\u0000${key}`;
}

function validateCaps(caps: PublisherSourceCaps): PublisherSourceCaps {
  for (const [key, value] of Object.entries(caps)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(`${key} must be a positive safe integer`);
    }
    const hardLimit = DEFAULT_PUBLISHER_SOURCE_CAPS[
      key as keyof PublisherSourceCaps
    ];
    if (value > hardLimit) {
      throw new RangeError(`${key} cannot exceed hard limit ${hardLimit}`);
    }
  }
  return caps;
}

function assertWatermark(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("watermark must be a non-negative safe integer");
  }
}

function numeric(value: unknown, label: string): number {
  const parsed = typeof value === "bigint" ? Number(value) : Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`invalid ${label}`);
  return parsed;
}

function nullableNumeric(value: unknown, label: string): number | null {
  return value === null || value === undefined ? null : numeric(value, label);
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`invalid ${label}`);
  return value;
}

function nullableText(value: unknown, label: string): string | null {
  return value === null || value === undefined ? null : text(value, label);
}

function booleanValue(value: unknown, label: string): boolean {
  const normalized = typeof value === "bigint" ? Number(value) : value;
  if (normalized === true || normalized === 1) return true;
  if (normalized === false || normalized === 0) return false;
  throw new Error(`invalid ${label}`);
}

function iso(value: number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("invalid timestamp");
  return date.toISOString();
}

function timestamp(value: unknown, label: string): string | null {
  const parsed = nullableNumeric(value, label);
  return parsed === null ? null : iso(parsed);
}
