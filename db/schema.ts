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
  numeric,
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
  "x-api",
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

/** App-level role. `admin` sees /admin/*, `editor` reserved for future authoring
 *  tools, `reader` is the default for anyone who signs in. */
export const userRoleEnum = pgEnum("user_role", ["admin", "editor", "reader"]);

/** Feedback vote kind. `up` / `down` are mutually exclusive per (item, user);
 *  `save` is an independent bookmark slot that can coexist with either. */
export const feedbackVoteEnum = pgEnum("feedback_vote", ["up", "down", "save"]);

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
  /** Newest external ID we've seen for this source (e.g. tweet ID). Used by
   *  the x-api adapter as `since_id` so each cron tick only pays for fresh
   *  tweets. Other adapters (RSS/atom/scrape) ignore this — their dedup runs
   *  via raw_items unique(source, external). */
  lastExternalId: text("last_external_id"),
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
    /** RSS-derived body — often just the description snippet. Kept as the
     *  fallback when full-article fetch fails or is paywalled. */
    body: text("body").notNull(),
    /** Full article markdown from Jina Reader (r.jina.ai). Populated after
     *  normalize, before enrich. Null while pending fetch or if fetch failed.
     *  Truncate reads to ~8K chars before passing to the LLM. */
    bodyMd: text("body_md"),
    /** Last time we attempted to fetch bodyMd (success or failure).
     *  Used to avoid re-fetching in a tight loop. */
    bodyFetchedAt: timestamp("body_fetched_at", { withTimezone: true }),
    url: text("url").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    contentHash: text("content_hash").notNull(),
    author: text("author"),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // ── Enrichment (M2) ──
    /** Bilingual titles — LLM-translated during enrichment. Old rows may be null,
     *  UI falls back to the raw `title` field when missing. */
    titleZh: text("title_zh"),
    titleEn: text("title_en"),
    summaryZh: text("summary_zh"),
    summaryEn: text("summary_en"),
    importance: integer("importance"),
    /** featured | all | p1 | excluded */
    tier: text("tier"),
    /** { capabilities: string[], entities: string[], topics: string[] } */
    tags: jsonb("tags"),
    /** HKR rubric: { h: boolean, k: boolean, r: boolean }. Stored per-item so
     *  the UI can render per-axis chips and the agent can trend it over time. */
    hkr: jsonb("hkr"),
    /** Legacy single-lang reasoning (pre-bilingual). Kept as a fallback for
     *  older rows that haven't been re-scored yet. */
    reasoning: text("reasoning"),
    reasoningZh: text("reasoning_zh"),
    reasoningEn: text("reasoning_en"),
    enrichedAt: timestamp("enriched_at", { withTimezone: true }),
    policyVersion: text("policy_version"),
    // ── Editorial commentary (R7) — only populated for tier in (featured, p1) ──
    /** 1-2 sentence executive take (≤160 chars). */
    editorNoteZh: text("editor_note_zh"),
    editorNoteEn: text("editor_note_en"),
    /** 3-5 paragraph markdown analysis (≤900 words). */
    editorAnalysisZh: text("editor_analysis_zh"),
    editorAnalysisEn: text("editor_analysis_en"),
    commentaryAt: timestamp("commentary_at", { withTimezone: true }),
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
    unfetchedBodyIdx: index("items_unfetched_body_idx")
      .on(t.bodyFetchedAt)
      .where(sql`${t.bodyFetchedAt} IS NULL`),
    unclusteredIdx: index("items_unclustered_idx")
      .on(t.clusteredAt)
      .where(sql`${t.clusteredAt} IS NULL AND ${t.embedding} IS NOT NULL`),
    clusterIdx: index("items_cluster_idx").on(t.clusterId, t.publishedAt),
  }),
);

/**
 * newsletters — daily + monthly editorial digests. One row per (kind, locale,
 * period_start). Generated by a Pro-grade agent reading all items from the
 * window; surfaced via /api/feed/newsletter/rss.xml and the /newsletter page.
 */
export const newsletters = pgTable(
  "newsletters",
  {
    id: serial("id").primaryKey(),
    /** 'daily' | 'monthly' */
    kind: text("kind").notNull(),
    /** 'zh' | 'en' */
    locale: text("locale").notNull(),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    headline: text("headline").notNull(),
    /** 全局概览 — 3-4 sentence overview of the window. */
    overview: text("overview").notNull(),
    /** 特别关注 — 3-5 markdown bullet points on must-read stories,
     *  each optionally linking back to an item id. */
    highlights: text("highlights").notNull(),
    /** 点评 — 2-3 paragraph markdown analysis on themes + what to watch. */
    commentary: text("commentary").notNull(),
    /** List of referenced item IDs (for backlinks + crediting). */
    itemIds: jsonb("item_ids").$type<number[]>(),
    storyCount: integer("story_count").notNull().default(0),
    publishedAt: timestamp("published_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("newsletters_kind_locale_period_idx").on(
      t.kind,
      t.locale,
      t.periodStart,
    ),
    recentIdx: index("newsletters_recent_idx").on(t.publishedAt),
  }),
);

/**
 * llm_usage — per-call LLM token usage and cost ledger.
 * One row per generateText / generateStructured / embed call. Cost is computed
 * at insert time using LiteLLM pricing (see lib/llm/pricing.ts); rows with
 * null cost_usd indicate a model that wasn't in the pricing table at call time.
 */
export const llmUsage = pgTable(
  "llm_usage",
  {
    id: serial("id").primaryKey(),
    provider: text("provider").notNull(),
    /** The fully-qualified model/deployment string as seen by the provider. */
    model: text("model").notNull(),
    /** Business task label — 'enrich' | 'score' | 'embed' | 'commentary' | 'newsletter' | 'agent' | 'other'. */
    task: text("task"),
    inputTokens: integer("input_tokens").notNull().default(0),
    cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    reasoningTokens: integer("reasoning_tokens").notNull().default(0),
    /** USD. 6 decimal places so sub-cent totals stay accurate across many rows. */
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }),
    /** Optional FK to items — set when the call enriched a specific story. */
    itemId: integer("item_id"),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    createdAtIdx: index("llm_usage_created_at_idx").on(t.createdAt),
    providerModelIdx: index("llm_usage_provider_model_idx").on(
      t.provider,
      t.model,
      t.createdAt,
    ),
    taskIdx: index("llm_usage_task_idx").on(t.task, t.createdAt),
  }),
);

/**
 * users — mirrors Supabase `auth.users` on (id, email). Populated lazily on
 * first authenticated request (upsert on id from JWT `sub`). `role` drives
 * in-app authorization; admin gate additionally checks ALLOWED_ADMIN_EMAILS.
 *
 * No FK to auth.users because that lives in a different Postgres schema that
 * drizzle doesn't model. The upsert-on-sign-in keeps these two in sync.
 */
export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    role: userRoleEnum("role").notNull().default("reader"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    emailIdx: uniqueIndex("users_email_idx").on(t.email),
  }),
);

/**
 * feedback — one row per (item, user, vote). Acts as a toggle store: the
 * presence of a row means the user has that vote active; deleting the row
 * clears it. The API layer enforces up/down mutual exclusion (saving 'down'
 * clears any existing 'up' for the same item+user). `save` is independent
 * of the up/down axis so a user can upvote AND bookmark the same story.
 */
export const feedback = pgTable(
  "feedback",
  {
    id: serial("id").primaryKey(),
    itemId: integer("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    vote: feedbackVoteEnum("vote").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniqVote: uniqueIndex("feedback_item_user_vote_idx").on(
      t.itemId,
      t.userId,
      t.vote,
    ),
    userRecentIdx: index("feedback_user_recent_idx").on(
      t.userId,
      t.createdAt,
    ),
    itemIdx: index("feedback_item_idx").on(t.itemId, t.createdAt),
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
export type LlmUsage = typeof llmUsage.$inferSelect;
export type NewLlmUsage = typeof llmUsage.$inferInsert;
export type Newsletter = typeof newsletters.$inferSelect;
export type NewNewsletter = typeof newsletters.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Feedback = typeof feedback.$inferSelect;
export type NewFeedback = typeof feedback.$inferInsert;

export type { TSourceKind, TSourceGroup, TCadence };
