import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  real,
  uniqueIndex,
  index,
  customType,
} from "drizzle-orm/sqlite-core";
import {
  CADENCES,
  FEEDBACK_VOTES,
  ITERATION_STATUSES,
  SOURCE_GROUPS,
  SOURCE_HEALTH_STATUSES,
  SOURCE_KINDS,
  SOURCE_LOCALES,
  USER_ROLES,
} from "@/lib/types";
import type {
  SourceKind as TSourceKind,
  SourceGroup as TSourceGroup,
  Cadence as TCadence,
} from "@/lib/types";

// ── Storage conventions (Turso libSQL / SQLite — NEWSROOM-TURSO 2026-07-11) ──
// Replaced Supabase Postgres. Mappings from the old pg-core schema:
//   timestamptz  → INTEGER ms epoch (drizzle `timestamp_ms` mode ⇄ JS Date)
//   jsonb        → TEXT JSON (drizzle `json` mode)
//   boolean      → INTEGER 0/1 (drizzle `boolean` mode)
//   serial       → INTEGER PRIMARY KEY AUTOINCREMENT
//   numeric      → REAL
//   text[]       → TEXT JSON array
//   pg enums     → TEXT with drizzle enum typing (no DB-level CHECK)
//   halfvec(3072)→ F32_BLOB(3072) — libSQL native vector (see below)

/** DB-side default: current time as integer ms epoch (sub-second precision). */
const nowMs = sql`(CAST(unixepoch('subsec') * 1000 AS INTEGER))`;

// ── Custom libSQL vector type ───────────────────────────────────
// libSQL native vector search replaces pgvector. F32_BLOB(3072) stores
// text-embedding-3-large's native 3072-dim output as little-endian float32
// (12,288 bytes/row). We bind raw Float32Array buffers on write — a raw
// F32 blob IS a valid vector literal, and this sidesteps the drizzle
// customType + vector32() template bug (drizzle-orm #3899). The DiskANN
// index (`items_embedding_idx`) can't be expressed by drizzle-kit; it is
// created by scripts/ops/db-create-vector-index.ts — rerun it after any
// schema push (drizzle-kit also false-diffs custom-typed columns, #3047:
// NEVER let a push drop/recreate the embedding column).

/** Encode number[] as a raw little-endian F32 blob. Rejects non-finite cells. */
export function embeddingToDriver(value: number[]): Buffer {
  for (const n of value) {
    if (!Number.isFinite(n)) {
      throw new Error("embedding: non-finite cell in input");
    }
  }
  return Buffer.from(new Float32Array(value).buffer);
}

/** Decode an F32 blob (Buffer/ArrayBuffer/Uint8Array) back to number[]. */
export function embeddingFromDriver(value: unknown): number[] {
  if (value instanceof ArrayBuffer) {
    return Array.from(new Float32Array(value));
  }
  if (ArrayBuffer.isView(value)) {
    // Node Buffers can be views into a pooled ArrayBuffer — slice by
    // byteOffset/byteLength or we'd read neighboring allocations.
    const v = value as Uint8Array;
    return Array.from(
      new Float32Array(v.buffer, v.byteOffset, v.byteLength / 4),
    );
  }
  return value as number[];
}

/** JSON-array text form — what vector32(?) / vector_top_k(?) params expect. */
export function embeddingToVectorText(value: number[]): string {
  for (const n of value) {
    if (!Number.isFinite(n)) {
      throw new Error("embedding: non-finite cell in input");
    }
  }
  return `[${value.join(",")}]`;
}

export const float32Vector = customType<{
  data: number[];
  driverData: Buffer;
  config: { dimensions: number };
}>({
  dataType(config) {
    if (!config?.dimensions) {
      throw new Error("float32Vector requires `dimensions`");
    }
    return `F32_BLOB(${config.dimensions})`;
  },
  fromDriver(value): number[] {
    return embeddingFromDriver(value);
  },
  toDriver(value: number[]): Buffer {
    return embeddingToDriver(value);
  },
});

// ── Tables ──────────────────────────────────────────────────────

export const sources = sqliteTable(
  "sources",
  {
    id: text("id").primaryKey(),
    nameEn: text("name_en").notNull(),
    nameZh: text("name_zh").notNull(),
    url: text("url").notNull(),
    kind: text("kind", { enum: SOURCE_KINDS }).notNull(),
    group: text("group", { enum: SOURCE_GROUPS }).notNull(),
    locale: text("locale", { enum: SOURCE_LOCALES }).notNull(),
    cadence: text("cadence", { enum: CADENCES }).notNull(),
    priority: integer("priority").notNull().default(2),
    tags: text("tags", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    /** Operator-opted-in sources (community digests, hand-picked YouTube
     *  channels, etc.) get a tier floor of "all" regardless of scorer verdict.
     *  Scorer still runs for importance/HKR, but never forces "excluded".
     *  Replaces the previous hardcoded `*-yt` check in workers/enrich. */
    neverExclude: integer("never_exclude", { mode: "boolean" })
      .notNull()
      .default(false),
    /** Hand-picked sources surfaced on the "AX 严选 / curated" nav tab.
     *  Distinct from `never_exclude` on purpose: never_exclude is a pipeline
     *  behavior (tier floor at scorer), curated is a UI-level opt-in for the
     *  editorial picks tab. YouTube channels stay on /podcasts so they don't
     *  need this flag; newsletters/digests worth surfacing do. */
    curated: integer("curated", { mode: "boolean" }).notNull().default(false),
    notes: text("notes"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
  },
  (t) => ({
    cadenceIdx: index("sources_cadence_idx").on(t.cadence, t.enabled),
  }),
);

export const sourceHealth = sqliteTable("source_health", {
  sourceId: text("source_id")
    .primaryKey()
    .references(() => sources.id, { onDelete: "cascade" }),
  status: text("status", { enum: SOURCE_HEALTH_STATUSES })
    .notNull()
    .default("pending"),
  lastFetchedAt: integer("last_fetched_at", { mode: "timestamp_ms" }),
  lastSuccessAt: integer("last_success_at", { mode: "timestamp_ms" }),
  lastError: text("last_error"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  lastItemsCount: integer("last_items_count").notNull().default(0),
  totalItemsCount: integer("total_items_count").notNull().default(0),
  /** Newest external ID we've seen for this source (e.g. tweet ID). Used by
   *  the x-api adapter as `since_id` so each cron tick only pays for fresh
   *  tweets. Other adapters (RSS/atom/scrape) ignore this — their dedup runs
   *  via raw_items unique(source, external). */
  lastExternalId: text("last_external_id"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(nowMs),
});

export const rawItems = sqliteTable(
  "raw_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    url: text("url"),
    title: text("title"),
    publishedAt: integer("published_at", { mode: "timestamp_ms" }),
    fetchedAt: integer("fetched_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
    normalizedAt: integer("normalized_at", { mode: "timestamp_ms" }),
    /** Large JSON payload — stays LAST (see items note on SQLite row layout). */
    rawPayload: text("raw_payload", { mode: "json" }).notNull(),
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

/**
 * clusters — groups of items covering the same real-world event.
 *
 * Extended 2026-04-24 (event-aggregation phase) to carry event-level
 * editorial fields — canonical titles, commentary, importance, tier —
 * lifted from items so a single event produces a single feed card and
 * a single commentary generation regardless of coverage count.
 *
 * TypeScript imports this same table as `events` (see alias at bottom
 * of this file) for semantic clarity in new code; the physical table
 * name stays `clusters` to preserve the existing `items.cluster_id` FK
 * without a rename migration.
 */
export const clusters = sqliteTable(
  "clusters",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Canonical lead item shown in the timeline. No FK constraint (circular dep). */
    leadItemId: integer("lead_item_id").notNull(),
    memberCount: integer("member_count").notNull().default(1),
    /** Inception — day the event broke. Archive anchor. */
    firstSeenAt: integer("first_seen_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
    /** Last time a new member joined or Stage B rearbitrated. Trending-now anchor. */
    latestMemberAt: integer("latest_member_at", { mode: "timestamp_ms" }),
    /** Cached coverage count — mirrors member_count for now but kept
     *  distinct to leave room for future weighting (e.g. corroborating
     *  vs primary, if we ever add role annotation). */
    coverage: integer("coverage").notNull().default(1),
    // ── Canonical event name (Haiku-generated when member_count ≥ 2) ──
    canonicalTitleZh: text("canonical_title_zh"),
    canonicalTitleEn: text("canonical_title_en"),
    /** Last time canonical_title_* was regenerated. Used to throttle
     *  regen when membership grows slowly. */
    titledAt: integer("titled_at", { mode: "timestamp_ms" }),
    // ── Event-level summaries (copied from lead on migration; regenerated on multi-member change) ──
    summaryZh: text("summary_zh"),
    summaryEn: text("summary_en"),
    // ── Event-level editorial commentary — replaces per-item fields for multi-member clusters ──
    editorNoteZh: text("editor_note_zh"),
    editorNoteEn: text("editor_note_en"),
    editorAnalysisZh: text("editor_analysis_zh"),
    editorAnalysisEn: text("editor_analysis_en"),
    commentaryAt: integer("commentary_at", { mode: "timestamp_ms" }),
    // ── Event importance + tier (computed from members + coverage boost) ──
    importance: integer("importance"),
    /** featured | p1 | all | excluded — matches items.tier semantics but event-level. */
    eventTier: text("event_tier"),
    hkr: text("hkr", { mode: "json" }),
    // ── Stage B verdict lock — prevents Stage A from reshuffling LLM-confirmed membership. ──
    verifiedAt: integer("verified_at", { mode: "timestamp_ms" }),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
  },
  (t) => ({
    firstSeenIdx: index("clusters_first_seen_at_idx").on(t.firstSeenAt),
    latestMemberIdx: index("clusters_latest_member_at_idx").on(t.latestMemberAt),
    tierLatestIdx: index("clusters_tier_latest_idx").on(
      t.eventTier,
      t.latestMemberAt,
    ),
  }),
);

export const items = sqliteTable(
  "items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    rawItemId: integer("raw_item_id")
      .notNull()
      .references(() => rawItems.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** Last time we attempted to fetch bodyMd (success or failure).
     *  Used to avoid re-fetching in a tight loop. */
    bodyFetchedAt: integer("body_fetched_at", { mode: "timestamp_ms" }),
    url: text("url").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    contentHash: text("content_hash").notNull(),
    author: text("author"),
    publishedAt: integer("published_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
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
    tags: text("tags", { mode: "json" }),
    /** HKR rubric: { h: boolean, k: boolean, r: boolean }. Stored per-item so
     *  the UI can render per-axis chips and the agent can trend it over time. */
    hkr: text("hkr", { mode: "json" }),
    /** Legacy single-lang reasoning (pre-bilingual). Kept as a fallback for
     *  older rows that haven't been re-scored yet. */
    reasoning: text("reasoning"),
    reasoningZh: text("reasoning_zh"),
    reasoningEn: text("reasoning_en"),
    enrichedAt: integer("enriched_at", { mode: "timestamp_ms" }),
    /** Claim/backoff guard for the enrich worker. Prevents overlapping cron
     * invocations from spending LLM calls on the same unenriched row. */
    enrichClaimedAt: integer("enrich_claimed_at", { mode: "timestamp_ms" }),
    enrichAttempts: integer("enrich_attempts").notNull().default(0),
    enrichError: text("enrich_error"),
    policyVersion: text("policy_version"),
    // ── Editorial commentary (R7) — only populated for tier in (featured, p1) ──
    /** 1-2 sentence executive take (≤160 chars). */
    editorNoteZh: text("editor_note_zh"),
    editorNoteEn: text("editor_note_en"),
    /** 3-5 paragraph markdown analysis (≤900 words). */
    editorAnalysisZh: text("editor_analysis_zh"),
    editorAnalysisEn: text("editor_analysis_en"),
    commentaryAt: integer("commentary_at", { mode: "timestamp_ms" }),
    // ── Clustering (M2) ──
    clusterId: integer("cluster_id").references(() => clusters.id, {
      onDelete: "set null",
    }),
    clusteredAt: integer("clustered_at", { mode: "timestamp_ms" }),
    /** Stage B (LLM arbitration) verdict lock. When set, Stage A
     *  embedding-based clustering will skip this item as a neighbor
     *  candidate — its cluster assignment has been LLM-confirmed. */
    clusterVerifiedAt: integer("cluster_verified_at", { mode: "timestamp_ms" }),
    // ── Large payloads — MUST STAY LAST (SQLite inlines them in the row;
    // reading any column stored AFTER a big value walks its overflow pages,
    // so a filter on e.g. cluster_id placed after these would drag ~45KB per
    // row through the page cache — measured 29s vs ~ms for a 21k-row scan).
    /** RSS-derived body — often just the description snippet. Kept as the
     *  fallback when full-article fetch fails or is paywalled. */
    body: text("body").notNull(),
    /** Full article markdown from Jina Reader (r.jina.ai). Populated after
     *  normalize, before enrich. Null while pending fetch or if fetch failed.
     *  Truncate reads to ~8K chars before passing to the LLM. */
    bodyMd: text("body_md"),
    embedding: float32Vector("embedding", { dimensions: 3072 }),
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
    enrichClaimIdx: index("items_enrich_claim_idx")
      .on(t.enrichClaimedAt)
      .where(sql`${t.enrichedAt} IS NULL`),
    unfetchedBodyIdx: index("items_unfetched_body_idx")
      .on(t.bodyFetchedAt)
      .where(sql`${t.bodyFetchedAt} IS NULL`),
    unclusteredIdx: index("items_unclustered_idx")
      .on(t.clusteredAt)
      .where(sql`${t.clusteredAt} IS NULL AND ${t.embedding} IS NOT NULL`),
    clusterIdx: index("items_cluster_idx").on(t.clusterId, t.publishedAt),
    /** Covering index for the feed WHERE shape (buildFeedWhere +
     *  countFeaturedStories): lets SQLite scan the index instead of the
     *  fat table rows. Column set must cover every items column those
     *  queries filter/join on. */
    feedCoverIdx: index("items_feed_cover_idx").on(
      t.enrichedAt,
      t.importance,
      t.tier,
      t.clusterId,
      t.sourceId,
      t.publishedAt,
    ),
    /** Pending Stage B — items the arbitrator hasn't seen yet. */
    clusterVerifiedIdx: index("items_cluster_verified_idx")
      .on(t.clusterVerifiedAt)
      .where(sql`${t.clusterVerifiedAt} IS NULL`),
  }),
);

/**
 * newsletters — daily + monthly editorial digests. One row per (kind, locale,
 * period_start). Generated by a Pro-grade agent reading all items from the
 * window; surfaced via /api/feed/newsletter/rss.xml and the /newsletter page.
 */
export const newsletters = sqliteTable(
  "newsletters",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** 'daily' | 'monthly' */
    kind: text("kind").notNull(),
    /** 'zh' | 'en' */
    locale: text("locale").notNull(),
    periodStart: integer("period_start", { mode: "timestamp_ms" }).notNull(),
    periodEnd: integer("period_end", { mode: "timestamp_ms" }).notNull(),
    /** Legacy structured-digest fields — populated for monthly newsletter
     *  format. New daily-column rows leave these NULL and write column_*
     *  instead. Nullable so daily writer can omit. */
    headline: text("headline"),
    /** 全局概览 — 3-4 sentence overview of the window (legacy / monthly). */
    overview: text("overview"),
    /** 特别关注 — 3-5 markdown bullet points (legacy / monthly). */
    highlights: text("highlights"),
    /** 点评 — 2-3 paragraph markdown analysis (legacy / monthly). */
    commentary: text("commentary"),
    /** Daily column — 卡兹克-voice 标题 ≤20 字, populated for kind='daily'
     *  new format. NULL for monthly + legacy daily rows. */
    columnTitle: text("column_title"),
    /** Daily column — numbered 1-5 markdown list, each entry 50-100 字
     *  with quick take + [#item-id] backlink. */
    columnSummaryMd: text("column_summary_md"),
    /** Daily column — 2000-4000 字 long-form narrative, no markdown
     *  subheadings, references summary entries as 第 N 件. */
    columnNarrativeMd: text("column_narrative_md"),
    /** Daily column — 1-3 item IDs given deep treatment in narrative_md. */
    columnFeaturedItemIds: text("column_featured_item_ids", {
      mode: "json",
    }).$type<number[]>(),
    /** Daily column — ≤8 字 day theme tag (e.g., "模型大战白热化"). */
    columnThemeTag: text("column_theme_tag"),
    /** AI HOT daily payload — full /api/public/daily response merged in as
     *  must-cover input for the column generator. NULL when AI HOT was
     *  unavailable that day or for legacy rows. See docs/aihot-integration/PLAN.md. */
    aihotDailyPayload: text("aihot_daily_payload", { mode: "json" }),
    /** Which AI HOT date got merged in (YYYY-MM-DD UTC). NULL when no payload. */
    aihotDailyDate: text("aihot_daily_date"),
    /** List of referenced item IDs (for backlinks + crediting). */
    itemIds: text("item_ids", { mode: "json" }).$type<number[]>(),
    storyCount: integer("story_count").notNull().default(0),
    publishedAt: integer("published_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
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
export const llmUsage = sqliteTable(
  "llm_usage",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    provider: text("provider").notNull(),
    /** The fully-qualified model/deployment string as seen by the provider. */
    model: text("model").notNull(),
    /** Business task label — 'enrich' | 'score' | 'embed' | 'commentary' | 'newsletter' | 'agent' | 'other'. */
    task: text("task"),
    inputTokens: integer("input_tokens").notNull().default(0),
    cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    reasoningTokens: integer("reasoning_tokens").notNull().default(0),
    /** USD. REAL (float64) keeps ~15 significant digits — plenty for
     *  sub-cent per-call costs (was numeric(12,6) on Postgres). */
    costUsd: real("cost_usd"),
    /** Optional FK to items — set when the call enriched a specific story. */
    itemId: integer("item_id"),
    durationMs: integer("duration_ms"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
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
 * users — app-level user rows. The browser UI runs on the shared
 * password-gate admin session (see lib/auth/session.ts, ADMIN_USER_ID);
 * API tokens can carry their own user IDs. Rows are upserted lazily before
 * FK-owned mutations. `role` drives in-app authorization.
 */
export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    role: text("role", { enum: USER_ROLES }).notNull().default("reader"),
    /** User-side display preferences (theme/accent/density/language/etc). Shape
     *  mirrors `Tweaks` in lib/tweaks.ts. Null = not yet saved server-side,
     *  falls back to localStorage then to TWEAK_DEFAULTS. */
    tweaks: text("tweaks", { mode: "json" }),
    /** User-configurable watchlist terms (["gpt-6", "agentic IDE", ...]). */
    watchlist: text("watchlist", { mode: "json" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
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
export const feedback = sqliteTable(
  "feedback",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    itemId: integer("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    vote: text("vote", { enum: FEEDBACK_VOTES }).notNull(),
    note: text("note"),
    /** Present only on vote='save' rows. Null = uncategorized (the default
     *  "inbox" collection). FK is intentionally nullable + on-delete-set-null
     *  so deleting a collection reparents its saves rather than losing them. */
    collectionId: integer("collection_id").references(
      () => savedCollections.id,
      { onDelete: "set null" },
    ),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
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
    collectionIdx: index("feedback_collection_idx").on(t.collectionId),
  }),
);

/**
 * saved_collections — user-named bookmark folders. One row per collection per
 * user. Referenced by `feedback.collection_id` for vote='save' rows so
 * the UI can surface named groups instead of just time-window buckets.
 *
 * `pinned` controls render ordering in the left sidebar. `sortOrder` is a
 * dense float so client-side reorders don't need to renumber the whole list.
 */
export const savedCollections = sqliteTable(
  "saved_collections",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    nameCjk: text("name_cjk"),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(1000),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
  },
  (t) => ({
    userIdx: index("saved_collections_user_idx").on(t.userId),
    uniqName: uniqueIndex("saved_collections_user_name_idx").on(
      t.userId,
      t.name,
    ),
  }),
);

/**
 * policy_versions — committed history of each agent-maintained skill file
 * (editorial, and whatever we add later). `version` is monotonic per skill.
 * v1 is seeded from `modules/feed/runtime/policy/skills/<name>.skill.md`
 * on first boot so workers never see an empty table. Subsequent versions
 * come from the M4 iteration agent.
 *
 * Runtime reads the latest row via lib/policy/skill.ts.
 */
export const policyVersions = sqliteTable(
  "policy_versions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    skillName: text("skill_name").notNull(),
    version: integer("version").notNull(),
    content: text("content").notNull(),
    /** Agent's reasoning summary for this revision; null for the v1 seed. */
    reasoning: text("reasoning"),
    /** Array of {id, verdict, title, note, createdAt} the agent saw. */
    feedbackSample: text("feedback_sample", { mode: "json" }),
    feedbackCount: integer("feedback_count").notNull().default(0),
    /** Admin email, or 'system' for the v1 seed. */
    committedBy: text("committed_by"),
    committedAt: integer("committed_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
  },
  (t) => ({
    uniqVersion: uniqueIndex("policy_versions_skill_version_idx").on(
      t.skillName,
      t.version,
    ),
    latestIdx: index("policy_versions_latest_idx").on(
      t.skillName,
      t.committedAt,
    ),
  }),
);

/**
 * iteration_runs — agent proposals in flight or awaiting admin decision.
 * `proposed` = waiting for admin apply/reject; `applied` = merged into
 * policy_versions; `rejected` / `failed` = terminal, kept for audit.
 *
 * Only ONE run per skill should be `proposed` at a time (the UI enforces
 * this at the API layer; no DB constraint because retries/historical
 * rejects also sit here).
 */
export const iterationRuns = sqliteTable(
  "iteration_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    skillName: text("skill_name").notNull(),
    status: text("status", { enum: ITERATION_STATUSES }).notNull(),
    /** Version this iteration was based on (the one in production when
     *  the agent started). Null means no prior version existed. */
    baseVersion: integer("base_version"),
    /** Full proposed skill content. Null while status='running' or failed. */
    proposedContent: text("proposed_content"),
    /** Short ≤2000-char summary of what the agent changed and why. */
    reasoningSummary: text("reasoning_summary"),
    /** Raw structured agent output (full reasoning, didNotChange notes). */
    agentOutput: text("agent_output", { mode: "json" }),
    feedbackSample: text("feedback_sample", { mode: "json" }),
    feedbackCount: integer("feedback_count").notNull().default(0),
    error: text("error"),
    /** Admin email that kicked this off. */
    requestedBy: text("requested_by").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  },
  (t) => ({
    statusIdx: index("iteration_runs_status_idx").on(t.skillName, t.status),
    recentIdx: index("iteration_runs_recent_idx").on(t.createdAt),
  }),
);

/**
 * cluster_splits — audit trail for Stage B LLM arbitration verdicts.
 *
 * One row per item that the arbitrator decided doesn't belong to the
 * cluster it was provisionally assigned to by Stage A embedding similarity.
 * Surviving members (those the arbitrator kept) are not logged here.
 *
 * Retained for weekly operator review + as future training signal for
 * prompt tuning. No FK to from_cluster_id because clusters can be GC'd
 * and the audit should survive.
 */
export const clusterSplits = sqliteTable(
  "cluster_splits",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    itemId: integer("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    /** No FK — clusters can be GC'd; audit outlives them. */
    fromClusterId: integer("from_cluster_id").notNull(),
    /** Arbitrator's reason, ≤280 chars. */
    reason: text("reason").notNull(),
    splitAt: integer("split_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
  },
  (t) => ({
    recentIdx: index("cluster_splits_recent_idx").on(t.splitAt),
    itemIdx: index("cluster_splits_item_idx").on(t.itemId),
  }),
);

/**
 * api_tokens — Bearer tokens used by external agents to hit /api/v1/*.
 *
 * Storage model mirrors lib/auth/password.ts's HMAC scheme: we never persist
 * the plaintext token, only sha256(token). Tokens themselves are 32 random
 * bytes (256 bits of entropy from crypto.randomBytes), so brute-force is
 * impossible by construction — we use sha256 rather than bcrypt so the
 * per-request lookup is O(log n) via the unique index instead of a full
 * table scan. See scripts/ops/mint-api-token.ts for minting.
 *
 * v1 = single-user, single-scope (token grants full read+write over the
 * admin user's data). If we reintroduce multi-user in v2, add a
 * `scopes` JSON column rather than splitting the table.
 */
export const apiTokens = sqliteTable(
  "api_tokens",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Hex-encoded sha256(token). Unique. */
    tokenHash: text("token_hash").notNull(),
    /** Human-readable identifier (e.g. "claude-desktop", "cursor-laptop")
     *  so the operator can recognize + revoke individual tokens. */
    label: text("label").notNull(),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
    /** Non-null = revoked; auth middleware treats these as not-found. */
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
  },
  (t) => ({
    hashIdx: uniqueIndex("api_tokens_token_hash_idx").on(t.tokenHash),
    userIdx: index("api_tokens_user_idx").on(t.userId),
  }),
);

/**
 * column_qc_log — observability for daily-column L1-L2 self-check hits.
 * Non-blocking: a column with hits still ships; this gives the operator a
 * queryable record of recurring voice-rule violations. One row per cron run
 * that flagged ≥1 hit. Cleaned up alongside the parent newsletter row.
 */
export const columnQcLog = sqliteTable("column_qc_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  newsletterId: integer("newsletter_id").references(() => newsletters.id, {
    onDelete: "cascade",
  }),
  generatedAt: integer("generated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(nowMs),
  l1Pass: integer("l1_pass", { mode: "boolean" }).notNull(),
  l2Pass: integer("l2_pass", { mode: "boolean" }).notNull(),
  hits: text("hits", { mode: "json" }).$type<
    { layer: "l1" | "l2"; rule: string; snippet: string }[]
  >(),
});

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
export type PolicyVersion = typeof policyVersions.$inferSelect;
export type NewPolicyVersion = typeof policyVersions.$inferInsert;
export type IterationRun = typeof iterationRuns.$inferSelect;
export type NewIterationRun = typeof iterationRuns.$inferInsert;
export type ApiToken = typeof apiTokens.$inferSelect;
export type NewApiToken = typeof apiTokens.$inferInsert;

// ── Event-aggregation aliases (clusters table repurposed as first-class events) ──
/** Semantic alias — the clusters table represents "events" in the
 *  event-aggregation model (canonical titles, cross-source commentary,
 *  coverage boost). Physical table name is `clusters` for FK continuity
 *  with items.cluster_id. New code should import `events`; existing code
 *  using `clusters` continues to work. */
export const events = clusters;
export type Event = typeof clusters.$inferSelect;
export type NewEvent = typeof clusters.$inferInsert;
export type ClusterSplit = typeof clusterSplits.$inferSelect;
export type NewClusterSplit = typeof clusterSplits.$inferInsert;
export type ColumnQcLog = typeof columnQcLog.$inferSelect;
export type NewColumnQcLog = typeof columnQcLog.$inferInsert;

export type { TSourceKind, TSourceGroup, TCadence };
