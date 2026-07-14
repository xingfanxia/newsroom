import { createHash } from "node:crypto";
import type { Client } from "@libsql/client";

export const PUBLIC_CONTENT_OUTBOX_MIGRATION =
  "20260714_public_content_outbox_v1";

const NOW_MS_SQL = "CAST(unixepoch('subsec') * 1000 AS INTEGER)";

const SCHEMA_MIGRATIONS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY NOT NULL,
  checksum TEXT NOT NULL,
  applied_at INTEGER NOT NULL DEFAULT (${NOW_MS_SQL})
)`;

const OUTBOX_TABLE_SQL = `CREATE TABLE IF NOT EXISTS public_content_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  operation TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (${NOW_MS_SQL})
)`;

const OUTBOX_ENTITY_INDEX_SQL = `CREATE INDEX IF NOT EXISTS public_content_outbox_entity_idx
ON public_content_outbox (entity_type, entity_key, id)`;

const ITEM_PUBLIC_COLUMNS = [
  "source_id",
  "cluster_id",
  "title",
  "title_zh",
  "title_en",
  "summary_zh",
  "summary_en",
  "editor_note_zh",
  "editor_note_en",
  "editor_analysis_zh",
  "editor_analysis_en",
  "body_md",
  "author",
  "url",
  "canonical_url",
  "tags",
  "importance",
  "tier",
  "hkr",
  "published_at",
  "created_at",
  "enriched_at",
  "commentary_at",
] as const;

const EVENT_PUBLIC_COLUMNS = [
  "lead_item_id",
  "member_count",
  "coverage",
  "first_seen_at",
  "latest_member_at",
  "canonical_title_zh",
  "canonical_title_en",
  "editor_note_zh",
  "editor_note_en",
  "editor_analysis_zh",
  "editor_analysis_en",
  "importance",
  "event_tier",
  "hkr",
  "no_content",
] as const;

const SOURCE_PUBLIC_COLUMNS = [
  "name_en",
  "name_zh",
  "url",
  "kind",
  "group",
  "locale",
  "cadence",
  "priority",
  "tags",
  "enabled",
  "curated",
] as const;

const SOURCE_HEALTH_PUBLIC_COLUMNS = [
  "status",
  "last_success_at",
  "consecutive_failures",
  "total_items_count",
] as const;

const NEWSLETTER_PUBLIC_COLUMNS = [
  "kind",
  "locale",
  "period_start",
  "period_end",
  "headline",
  "overview",
  "highlights",
  "commentary",
  "column_title",
  "column_summary_md",
  "column_narrative_md",
  "column_featured_item_ids",
  "column_theme_tag",
  "item_ids",
  "story_count",
  "published_at",
] as const;

const POLICY_PUBLIC_COLUMNS = [
  "skill_name",
  "version",
  "content",
  "committed_at",
] as const;

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function updateColumns(columns: readonly string[]): string {
  return columns.map(quoteIdentifier).join(", ");
}

function changed(columns: readonly string[]): string {
  return columns
    .map(
      (column) =>
        `OLD.${quoteIdentifier(column)} IS NOT NEW.${quoteIdentifier(column)}`,
    )
    .join(" OR ");
}

function enqueue(
  entityType: string,
  entityKeySql: string,
  operationSql: string,
): string {
  return `INSERT INTO public_content_outbox
    (entity_type, entity_key, operation)
  VALUES ('${entityType}', ${entityKeySql}, ${operationSql});`;
}

function enqueueWhere(
  entityType: string,
  entityKeySql: string,
  operationSql: string,
  predicate: string,
): string {
  return `INSERT INTO public_content_outbox
    (entity_type, entity_key, operation)
  SELECT '${entityType}', ${entityKeySql}, ${operationSql}
  WHERE ${predicate};`;
}

function itemEligible(alias: "OLD" | "NEW"): string {
  return `(${alias}.enriched_at IS NOT NULL
    AND ${alias}.importance IS NOT NULL
    AND ${alias}.tier IN ('featured', 'p1', 'all'))`;
}

function eventCandidate(alias: "OLD" | "NEW"): string {
  return `(${alias}.member_count >= 2
    AND ${alias}.no_content = 0
    AND ${alias}.importance IS NOT NULL
    AND (${alias}.event_tier IS NULL
      OR ${alias}.event_tier IN ('featured', 'p1', 'all')))`;
}

const ITEM_TRIGGERS = [
  `CREATE TRIGGER IF NOT EXISTS public_items_ai
AFTER INSERT ON items
WHEN ${itemEligible("NEW")}
BEGIN
  ${enqueue("item", "CAST(NEW.id AS TEXT)", "'upsert'")}
  ${enqueueWhere("event", "CAST(NEW.cluster_id AS TEXT)", "'upsert'", "NEW.cluster_id IS NOT NULL")}
END`,
  `CREATE TRIGGER IF NOT EXISTS public_items_au
AFTER UPDATE OF ${updateColumns(ITEM_PUBLIC_COLUMNS)} ON items
WHEN (${changed(ITEM_PUBLIC_COLUMNS)})
  AND (${itemEligible("OLD")} OR ${itemEligible("NEW")})
BEGIN
  ${enqueue(
    "item",
    "CAST(NEW.id AS TEXT)",
    `CASE WHEN ${itemEligible("NEW")} THEN 'upsert' ELSE 'delete' END`,
  )}
  ${enqueueWhere("event", "CAST(OLD.cluster_id AS TEXT)", "'upsert'", "OLD.cluster_id IS NOT NULL")}
  ${enqueueWhere(
    "event",
    "CAST(NEW.cluster_id AS TEXT)",
    "'upsert'",
    "NEW.cluster_id IS NOT NULL AND NEW.cluster_id IS NOT OLD.cluster_id",
  )}
END`,
  `CREATE TRIGGER IF NOT EXISTS public_items_ad
AFTER DELETE ON items
WHEN ${itemEligible("OLD")}
BEGIN
  ${enqueue("item", "CAST(OLD.id AS TEXT)", "'delete'")}
  ${enqueueWhere("event", "CAST(OLD.cluster_id AS TEXT)", "'upsert'", "OLD.cluster_id IS NOT NULL")}
END`,
];

const EVENT_TRIGGERS = [
  `CREATE TRIGGER IF NOT EXISTS public_clusters_ai
AFTER INSERT ON clusters
WHEN ${eventCandidate("NEW")}
BEGIN
  ${enqueue("event", "CAST(NEW.id AS TEXT)", "'upsert'")}
END`,
  `CREATE TRIGGER IF NOT EXISTS public_clusters_au
AFTER UPDATE OF ${updateColumns(EVENT_PUBLIC_COLUMNS)} ON clusters
WHEN (${changed(EVENT_PUBLIC_COLUMNS)})
  AND (${eventCandidate("OLD")} OR ${eventCandidate("NEW")})
BEGIN
  ${enqueue(
    "event",
    "CAST(NEW.id AS TEXT)",
    `CASE WHEN ${eventCandidate("NEW")} THEN 'upsert' ELSE 'delete' END`,
  )}
END`,
  `CREATE TRIGGER IF NOT EXISTS public_clusters_ad
AFTER DELETE ON clusters
WHEN ${eventCandidate("OLD")}
BEGIN
  ${enqueue("event", "CAST(OLD.id AS TEXT)", "'delete'")}
END`,
];

function entityTriggers(args: {
  prefix: string;
  table: string;
  entityType: string;
  keyNew: string;
  keyOld: string;
  columns: readonly string[];
  insertWhen?: string;
  updateWhen?: string;
  deleteWhen?: string;
  deleteOperation?: "delete" | "upsert";
}): string[] {
  const insertWhen = args.insertWhen ? `\nWHEN ${args.insertWhen}` : "";
  const updateWhen = args.updateWhen
    ? ` AND (${args.updateWhen})`
    : "";
  const deleteWhen = args.deleteWhen ? `\nWHEN ${args.deleteWhen}` : "";
  const deleteOperation = args.deleteOperation ?? "delete";
  return [
    `CREATE TRIGGER IF NOT EXISTS ${args.prefix}_ai
AFTER INSERT ON ${args.table}${insertWhen}
BEGIN
  ${enqueue(args.entityType, args.keyNew, "'upsert'")}
END`,
    `CREATE TRIGGER IF NOT EXISTS ${args.prefix}_au
AFTER UPDATE OF ${updateColumns(args.columns)} ON ${args.table}
WHEN (${changed(args.columns)})${updateWhen}
BEGIN
  ${enqueue(args.entityType, args.keyNew, "'upsert'")}
END`,
    `CREATE TRIGGER IF NOT EXISTS ${args.prefix}_ad
AFTER DELETE ON ${args.table}${deleteWhen}
BEGIN
  ${enqueue(args.entityType, args.keyOld, `'${deleteOperation}'`)}
END`,
  ];
}

const ENTITY_TRIGGERS = [
  ...entityTriggers({
    prefix: "public_sources",
    table: "sources",
    entityType: "source",
    keyNew: "NEW.id",
    keyOld: "OLD.id",
    columns: SOURCE_PUBLIC_COLUMNS,
  }),
  ...entityTriggers({
    prefix: "public_source_health",
    table: "source_health",
    entityType: "source",
    keyNew: "NEW.source_id",
    keyOld: "OLD.source_id",
    columns: SOURCE_HEALTH_PUBLIC_COLUMNS,
    deleteOperation: "upsert",
  }),
  ...entityTriggers({
    prefix: "public_newsletters",
    table: "newsletters",
    entityType: "newsletter",
    keyNew: "CAST(NEW.id AS TEXT)",
    keyOld: "CAST(OLD.id AS TEXT)",
    columns: NEWSLETTER_PUBLIC_COLUMNS,
  }),
];

const POLICY_TRIGGERS = [
  `CREATE TRIGGER IF NOT EXISTS public_policy_versions_ai
AFTER INSERT ON policy_versions
WHEN NEW.skill_name = 'editorial'
BEGIN
  ${enqueue("policy", "NEW.skill_name", "'upsert'")}
END`,
  `CREATE TRIGGER IF NOT EXISTS public_policy_versions_au
AFTER UPDATE OF ${updateColumns(POLICY_PUBLIC_COLUMNS)} ON policy_versions
WHEN (${changed(POLICY_PUBLIC_COLUMNS)})
  AND (OLD.skill_name = 'editorial' OR NEW.skill_name = 'editorial')
BEGIN
  ${enqueueWhere("policy", "OLD.skill_name", "'upsert'", "OLD.skill_name = 'editorial'")}
  ${enqueueWhere(
    "policy",
    "NEW.skill_name",
    "'upsert'",
    "NEW.skill_name = 'editorial' AND NEW.skill_name IS NOT OLD.skill_name",
  )}
END`,
  `CREATE TRIGGER IF NOT EXISTS public_policy_versions_ad
AFTER DELETE ON policy_versions
WHEN OLD.skill_name = 'editorial'
BEGIN
  ${enqueue("policy", "OLD.skill_name", "'upsert'")}
END`,
];

export const PUBLIC_CONTENT_OUTBOX_TRIGGER_NAMES = [
  "public_items_ai",
  "public_items_au",
  "public_items_ad",
  "public_clusters_ai",
  "public_clusters_au",
  "public_clusters_ad",
  "public_sources_ai",
  "public_sources_au",
  "public_sources_ad",
  "public_source_health_ai",
  "public_source_health_au",
  "public_source_health_ad",
  "public_newsletters_ai",
  "public_newsletters_au",
  "public_newsletters_ad",
  "public_policy_versions_ai",
  "public_policy_versions_au",
  "public_policy_versions_ad",
] as const;

export const PUBLIC_CONTENT_OUTBOX_MIGRATION_STATEMENTS = [
  OUTBOX_TABLE_SQL,
  OUTBOX_ENTITY_INDEX_SQL,
  ...ITEM_TRIGGERS,
  ...EVENT_TRIGGERS,
  ...ENTITY_TRIGGERS,
  ...POLICY_TRIGGERS,
] as const;

export const PUBLIC_CONTENT_OUTBOX_MIGRATION_CHECKSUM = createHash("sha256")
  .update(
    [SCHEMA_MIGRATIONS_TABLE_SQL, ...PUBLIC_CONTENT_OUTBOX_MIGRATION_STATEMENTS]
      .join(";\n")
      .concat("\n"),
    "utf8",
  )
  .digest("hex");

export type PublicContentOutboxMigrationResult = {
  name: typeof PUBLIC_CONTENT_OUTBOX_MIGRATION;
  checksum: string;
  applied: boolean;
};

export async function migratePublicContentOutbox(
  client: Client,
): Promise<PublicContentOutboxMigrationResult> {
  await client.execute(SCHEMA_MIGRATIONS_TABLE_SQL);
  const transaction = await client.transaction("write");
  try {
    const existing = await transaction.execute({
      sql: "SELECT checksum FROM schema_migrations WHERE name = ?",
      args: [PUBLIC_CONTENT_OUTBOX_MIGRATION],
    });
    if (existing.rows.length > 0) {
      const checksum = String(existing.rows[0]?.checksum ?? "");
      if (checksum !== PUBLIC_CONTENT_OUTBOX_MIGRATION_CHECKSUM) {
        throw new Error(
          `migration checksum mismatch for ${PUBLIC_CONTENT_OUTBOX_MIGRATION}`,
        );
      }
      await transaction.commit();
      return {
        name: PUBLIC_CONTENT_OUTBOX_MIGRATION,
        checksum,
        applied: false,
      };
    }

    for (const statement of PUBLIC_CONTENT_OUTBOX_MIGRATION_STATEMENTS) {
      await transaction.execute(statement);
    }
    await transaction.execute({
      sql: `INSERT INTO schema_migrations (name, checksum)
            VALUES (?, ?)`,
      args: [
        PUBLIC_CONTENT_OUTBOX_MIGRATION,
        PUBLIC_CONTENT_OUTBOX_MIGRATION_CHECKSUM,
      ],
    });
    await transaction.commit();
    return {
      name: PUBLIC_CONTENT_OUTBOX_MIGRATION,
      checksum: PUBLIC_CONTENT_OUTBOX_MIGRATION_CHECKSUM,
      applied: true,
    };
  } finally {
    transaction.close();
  }
}
