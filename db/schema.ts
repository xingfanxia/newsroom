import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  boolean,
  pgEnum,
  uniqueIndex,
  index,
  serial,
} from "drizzle-orm/pg-core";
import type {
  SourceKind as TSourceKind,
  SourceGroup as TSourceGroup,
  Cadence as TCadence,
} from "@/lib/types";

// ── Enums ───────────────────────────────────────────────────────
export const sourceKindEnum = pgEnum("source_kind", [
  "rss",
  "atom",
  "api",
  "rsshub",
  "scrape",
]);

export const sourceGroupEnum = pgEnum("source_group", [
  "vendor-official",
  "media",
  "newsletter",
  "research",
  "social",
  "product",
  "podcast",
  "policy",
  "market",
]);

export const localeEnum = pgEnum("locale_kind", ["en", "zh", "multi"]);

export const cadenceEnum = pgEnum("cadence", [
  "live",
  "hourly",
  "daily",
  "weekly",
]);

export const healthStatusEnum = pgEnum("health_status", [
  "ok",
  "warning",
  "error",
  "pending",
]);

// ── Tables ──────────────────────────────────────────────────────

/** Source catalog — one row per configured feed. Seeded from lib/sources/catalog.ts */
export const sources = pgTable(
  "sources",
  {
    id: text("id").primaryKey(), // matches catalog.ts id
    nameEn: text("name_en").notNull(),
    nameZh: text("name_zh").notNull(),
    url: text("url").notNull(),
    kind: sourceKindEnum("kind").notNull(),
    group: sourceGroupEnum("group").notNull(),
    locale: localeEnum("locale").notNull(),
    cadence: cadenceEnum("cadence").notNull(),
    priority: integer("priority").notNull().default(2),
    tags: text("tags").array().notNull().default(sql`ARRAY[]::text[]`),
    enabled: boolean("enabled").notNull().default(true),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    cadenceIdx: index("sources_cadence_idx").on(t.cadence, t.enabled),
  }),
);

/** Source health — one row per source, updated each fetch tick. */
export const sourceHealth = pgTable("source_health", {
  sourceId: text("source_id")
    .primaryKey()
    .references(() => sources.id, { onDelete: "cascade" }),
  status: healthStatusEnum("status").notNull().default("pending"),
  lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastError: text("last_error"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  lastItemsCount: integer("last_items_count").notNull().default(0),
  totalItemsCount: integer("total_items_count").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Raw items — untouched payloads from a fetch, pre-normalization. */
export const rawItems = pgTable(
  "raw_items",
  {
    id: serial("id").primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(), // GUID from feed, URL hash for scrape
    url: text("url"),
    title: text("title"),
    rawPayload: jsonb("raw_payload").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    normalizedAt: timestamp("normalized_at", { withTimezone: true }),
  },
  (t) => ({
    uniqExternal: uniqueIndex("raw_items_source_external_idx").on(
      t.sourceId,
      t.externalId,
    ),
    unnormalizedIdx: index("raw_items_unnormalized_idx")
      .on(t.normalizedAt)
      .where(sql`${t.normalizedAt} IS NULL`),
  }),
);

/** Normalized items — clean title/body/url, ready for enrichment. */
export const items = pgTable(
  "items",
  {
    id: serial("id").primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    rawItemId: integer("raw_item_id")
      .notNull()
      .references(() => rawItems.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body").notNull(),
    url: text("url").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    contentHash: text("content_hash").notNull(), // sha256 over title+body
    author: text("author"),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Enrichment fields — populated in M2
    summaryZh: text("summary_zh"),
    summaryEn: text("summary_en"),
    importance: integer("importance"),
    tier: text("tier"), // featured | all | p1 | excluded
    tags: jsonb("tags"), // { capabilities, entities, topics }
    enrichedAt: timestamp("enriched_at", { withTimezone: true }),
    policyVersion: text("policy_version"),
  },
  (t) => ({
    contentHashIdx: uniqueIndex("items_content_hash_idx").on(t.contentHash),
    canonicalIdx: index("items_canonical_idx").on(t.canonicalUrl),
    publishedAtIdx: index("items_published_at_idx").on(t.publishedAt),
    sourceIdx: index("items_source_idx").on(t.sourceId, t.publishedAt),
    tierIdx: index("items_tier_idx").on(t.tier, t.publishedAt),
  }),
);

// ── Types ───────────────────────────────────────────────────────
export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;
export type SourceHealth = typeof sourceHealth.$inferSelect;
export type NewSourceHealth = typeof sourceHealth.$inferInsert;
export type RawItem = typeof rawItems.$inferSelect;
export type NewRawItem = typeof rawItems.$inferInsert;
export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;

// Re-export convenience for other modules
export type { TSourceKind, TSourceGroup, TCadence };
