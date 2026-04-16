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
  customType,
} from "drizzle-orm/pg-core";
import type {
  SourceKind as TSourceKind,
  SourceGroup as TSourceGroup,
  Cadence as TCadence,
} from "@/lib/types";

// ── Custom pgvector halfvec type ────────────────────────────────
// pgvector 0.8+ supports halfvec (fp16) with HNSW indexes up to 4000 dims,
// which lets us store text-embedding-3-large's native 3072-dim output
// without Matryoshka truncation. Same storage as vector(1536) at 6144 bytes.

/** Encode number[] into pgvector text format. Rejects non-finite cells. */
export function halfvecToDriver(value: number[]): string {
  for (const n of value) {
    if (!Number.isFinite(n)) {
      throw new Error("halfvec: non-finite cell in input");
    }
  }
  return `[${value.join(",")}]`;
}

/** Decode pgvector text format to number[]. Rejects any non-finite cell. */
export function halfvecFromDriver(value: unknown): number[] {
  if (typeof value !== "string") return value as unknown as number[];
  const trimmed =
    value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
  if (trimmed.length === 0) return [];
  return trimmed.split(",").map((raw) => {
    const cell = raw.trim();
    if (cell === "") {
      throw new Error("halfvec: empty cell in embedding");
    }
    const n = Number(cell);
    if (!Number.isFinite(n)) {
      throw new Error(
        `halfvec: non-finite cell in embedding (input="${cell.slice(0, 40)}")`,
      );
    }
    return n;
  });
}

export const halfvec = customType<{
  data: number[];
  driverData: string;
  config: { dimensions: number };
}>({
  dataType(config) {
    if (!config?.dimensions) {
      throw new Error("halfvec requires `dimensions`");
    }
    return `halfvec(${config.dimensions})`;
  },
  fromDriver(value): number[] {
    return halfvecFromDriver(value);
  },
  toDriver(value: number[]): string {
    return halfvecToDriver(value);
  },
});

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

export const sources = pgTable(
  "sources",
  {
    id: text("id").primaryKey(),
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

export const rawItems = pgTable(
  "raw_items",
  {
    id: serial("id").primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
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

/** Clusters — groups of near-duplicate items (cosine similarity > threshold). */
export const clusters = pgTable("clusters", {
  id: serial("id").primaryKey(),
  /** Canonical lead item shown in the timeline. No FK constraint (circular dep). */
  leadItemId: integer("lead_item_id").notNull(),
  memberCount: integer("member_count").notNull().default(1),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

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
    contentHash: text("content_hash").notNull(),
    author: text("author"),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // ── Enrichment (M2) ──
    summaryZh: text("summary_zh"),
    summaryEn: text("summary_en"),
    importance: integer("importance"),
    /** featured | all | p1 | excluded */
    tier: text("tier"),
    /** { capabilities: string[], entities: string[], topics: string[] } */
    tags: jsonb("tags"),
    reasoning: text("reasoning"),
    enrichedAt: timestamp("enriched_at", { withTimezone: true }),
    policyVersion: text("policy_version"),
    // ── Clustering (M2) ──
    embedding: halfvec("embedding", { dimensions: 3072 }),
    clusterId: integer("cluster_id").references(() => clusters.id, {
      onDelete: "set null",
    }),
    clusteredAt: timestamp("clustered_at", { withTimezone: true }),
  },
  (t) => ({
    contentHashIdx: uniqueIndex("items_content_hash_idx").on(t.contentHash),
    canonicalIdx: index("items_canonical_idx").on(t.canonicalUrl),
    publishedAtIdx: index("items_published_at_idx").on(t.publishedAt),
    sourceIdx: index("items_source_idx").on(t.sourceId, t.publishedAt),
    tierIdx: index("items_tier_idx").on(t.tier, t.publishedAt),
    unenrichedIdx: index("items_unenriched_idx")
      .on(t.enrichedAt)
      .where(sql`${t.enrichedAt} IS NULL`),
    unclusteredIdx: index("items_unclustered_idx")
      .on(t.clusteredAt)
      .where(sql`${t.clusteredAt} IS NULL AND ${t.embedding} IS NOT NULL`),
    clusterIdx: index("items_cluster_idx").on(t.clusterId, t.publishedAt),
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
export type Cluster = typeof clusters.$inferSelect;
export type NewCluster = typeof clusters.$inferInsert;

export type { TSourceKind, TSourceGroup, TCadence };
