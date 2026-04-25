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

export const iterationStatusEnum = pgEnum("iteration_status", [
  "running",
  "proposed",
  "applied",
  "rejected",
  "failed",
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
    /** Operator-opted-in sources (community digests, hand-picked YouTube
     *  channels, etc.) get a tier floor of "all" regardless of scorer verdict.
     *  Scorer still runs for importance/HKR, but never forces "excluded".
     *  Replaces the previous hardcoded `*-yt` check in workers/enrich. */
    neverExclude: boolean("never_exclude").notNull().default(false),
    /** Hand-picked sources surfaced on the "AX 严选 / curated" nav tab.
     *  Distinct from `never_exclude` on purpose: never_exclude is a pipeline
     *  behavior (tier floor at scorer), curated is a UI-level opt-in for the
     *  editorial picks tab. YouTube channels stay on /podcasts so they don't
     *  need this flag; newsletters/digests worth surfacing do. */
    curated: boolean("curated").notNull().default(false),
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
export const clusters = pgTable(
  "clusters",
  {
    id: serial("id").primaryKey(),
    /** Canonical lead item shown in the timeline. No FK constraint (circular dep). */
    leadItemId: integer("lead_item_id").notNull(),
    memberCount: integer("member_count").notNull().default(1),
    /** Inception — day the event broke. Archive anchor. */
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Last time a new member joined or Stage B rearbitrated. Trending-now anchor. */
    latestMemberAt: timestamp("latest_member_at", { withTimezone: true }),
    /** Cached coverage count — mirrors member_count for now but kept
     *  distinct to leave room for future weighting (e.g. corroborating
     *  vs primary, if we ever add role annotation). */
    coverage: integer("coverage").notNull().default(1),
    // ── Canonical event name (Haiku-generated when member_count ≥ 2) ──
    canonicalTitleZh: text("canonical_title_zh"),
    canonicalTitleEn: text("canonical_title_en"),
    /** Last time canonical_title_* was regenerated. Used to throttle
     *  regen when membership grows slowly. */
    titledAt: timestamp("titled_at", { withTimezone: true }),
    // ── Event-level summaries (copied from lead on migration; regenerated on multi-member change) ──
    summaryZh: text("summary_zh"),
    summaryEn: text("summary_en"),
    // ── Event-level editorial commentary — replaces per-item fields for multi-member clusters ──
    editorNoteZh: text("editor_note_zh"),
    editorNoteEn: text("editor_note_en"),
    editorAnalysisZh: text("editor_analysis_zh"),
    editorAnalysisEn: text("editor_analysis_en"),
    commentaryAt: timestamp("commentary_at", { withTimezone: true }),
    // ── Event importance + tier (computed from members + coverage boost) ──
    importance: integer("importance"),
    /** featured | p1 | all | excluded — matches items.tier semantics but event-level. */
    eventTier: text("event_tier"),
    hkr: jsonb("hkr"),
    // ── Stage B verdict lock — prevents Stage A from reshuffling LLM-confirmed membership. ──
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
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
    /** Stage B (LLM arbitration) verdict lock. When set, Stage A
     *  embedding-based clustering will skip this item as a neighbor
     *  candidate — its cluster assignment has been LLM-confirmed. */
    clusterVerifiedAt: timestamp("cluster_verified_at", { withTimezone: true }),
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
    columnFeaturedItemIds: jsonb("column_featured_item_ids").$type<number[]>(),
    /** Daily column — ≤8 字 day theme tag (e.g., "模型大战白热化"). */
    columnThemeTag: text("column_theme_tag"),
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
    /** User-side display preferences (theme/accent/density/language/etc). Shape
     *  mirrors `Tweaks` in hooks/use-tweaks.tsx. Null = not yet saved server-side,
     *  falls back to localStorage then to TWEAK_DEFAULTS. */
    tweaks: jsonb("tweaks"),
    /** User-configurable watchlist terms (["gpt-6", "agentic IDE", ...]). */
    watchlist: jsonb("watchlist"),
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
    /** Present only on vote='save' rows. Null = uncategorized (the default
     *  "inbox" collection). FK is intentionally nullable + on-delete-set-null
     *  so deleting a collection reparents its saves rather than losing them. */
    collectionId: integer("collection_id").references(
      () => savedCollections.id,
      { onDelete: "set null" },
    ),
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
export const savedCollections = pgTable(
  "saved_collections",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    nameCjk: text("name_cjk"),
    pinned: boolean("pinned").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(1000),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
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
export const policyVersions = pgTable(
  "policy_versions",
  {
    id: serial("id").primaryKey(),
    skillName: text("skill_name").notNull(),
    version: integer("version").notNull(),
    content: text("content").notNull(),
    /** Agent's reasoning summary for this revision; null for the v1 seed. */
    reasoning: text("reasoning"),
    /** Array of {id, verdict, title, note, createdAt} the agent saw. */
    feedbackSample: jsonb("feedback_sample"),
    feedbackCount: integer("feedback_count").notNull().default(0),
    /** Admin email, or 'system' for the v1 seed. */
    committedBy: text("committed_by"),
    committedAt: timestamp("committed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
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
export const iterationRuns = pgTable(
  "iteration_runs",
  {
    id: serial("id").primaryKey(),
    skillName: text("skill_name").notNull(),
    status: iterationStatusEnum("status").notNull(),
    /** Version this iteration was based on (the one in production when
     *  the agent started). Null means no prior version existed. */
    baseVersion: integer("base_version"),
    /** Full proposed skill content. Null while status='running' or failed. */
    proposedContent: text("proposed_content"),
    /** Short ≤2000-char summary of what the agent changed and why. */
    reasoningSummary: text("reasoning_summary"),
    /** Raw structured agent output (full reasoning, didNotChange notes). */
    agentOutput: jsonb("agent_output"),
    feedbackSample: jsonb("feedback_sample"),
    feedbackCount: integer("feedback_count").notNull().default(0),
    error: text("error"),
    /** Admin email that kicked this off. */
    requestedBy: text("requested_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
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
export const clusterSplits = pgTable(
  "cluster_splits",
  {
    id: serial("id").primaryKey(),
    itemId: integer("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    /** No FK — clusters can be GC'd; audit outlives them. */
    fromClusterId: integer("from_cluster_id").notNull(),
    /** Arbitrator's reason, ≤280 chars. */
    reason: text("reason").notNull(),
    splitAt: timestamp("split_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
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
 * `scopes text[]` column rather than splitting the table.
 */
export const apiTokens = pgTable(
  "api_tokens",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Hex-encoded sha256(token). Unique. */
    tokenHash: text("token_hash").notNull(),
    /** Human-readable identifier (e.g. "claude-desktop", "cursor-laptop")
     *  so the operator can recognize + revoke individual tokens. */
    label: text("label").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Non-null = revoked; auth middleware treats these as not-found. */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
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
export const columnQcLog = pgTable("column_qc_log", {
  id: serial("id").primaryKey(),
  newsletterId: integer("newsletter_id").references(() => newsletters.id, {
    onDelete: "cascade",
  }),
  generatedAt: timestamp("generated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  l1Pass: boolean("l1_pass").notNull(),
  l2Pass: boolean("l2_pass").notNull(),
  hits: jsonb("hits").$type<
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
