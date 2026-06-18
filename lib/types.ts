export const SOURCE_KINDS = [
  "rss",
  "atom",
  "api",
  "rsshub",
  "scrape",
  "x-api",
  "aihot-api",
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const FETCHABLE_SOURCE_KINDS = [
  "rss",
  "atom",
  "rsshub",
  "x-api",
  "aihot-api",
] as const satisfies readonly SourceKind[];
export type FetchableSourceKind = (typeof FETCHABLE_SOURCE_KINDS)[number];

export const SOURCE_GROUPS = [
  "vendor-official",
  "media",
  "newsletter",
  "research",
  "social",
  "product",
  "podcast",
  "policy",
  "market",
] as const;
export type SourceGroup = (typeof SOURCE_GROUPS)[number];

export const CADENCES = ["live", "hourly", "daily", "weekly"] as const;
export type Cadence = (typeof CADENCES)[number];

export const APP_LOCALES = ["zh", "en"] as const;
export type AppLocale = (typeof APP_LOCALES)[number];
const APP_LOCALE_LANGUAGE_TAGS = {
  zh: "zh-CN",
  en: "en-US",
} as const satisfies Record<AppLocale, string>;
export type AppLocaleLanguageTag =
  (typeof APP_LOCALE_LANGUAGE_TAGS)[AppLocale];

export function appLocaleLanguageTag(
  locale: AppLocale,
): AppLocaleLanguageTag {
  return APP_LOCALE_LANGUAGE_TAGS[locale];
}

export const DAILY_NEWSLETTER_KIND = "daily";
export const MONTHLY_NEWSLETTER_KIND = "monthly";
export const NEWSLETTER_KINDS = [
  DAILY_NEWSLETTER_KIND,
  MONTHLY_NEWSLETTER_KIND,
] as const;
export type NewsletterKind = (typeof NEWSLETTER_KINDS)[number];

export const NEWSLETTER_LOCALES = APP_LOCALES;
export type NewsletterLocale = AppLocale;
export const DAILY_COLUMN_LOCALE = "zh" satisfies NewsletterLocale;

export const SOURCE_LOCALES = ["en", "zh", "multi"] as const;
type SourceLocale = (typeof SOURCE_LOCALES)[number];

export const SOURCE_HEALTH_STATUSES = [
  "ok",
  "warning",
  "error",
  "pending",
] as const;
export type SourceHealthStatus = (typeof SOURCE_HEALTH_STATUSES)[number];

export const USER_ADMIN_ROLE = "admin";
const USER_EDITOR_ROLE = "editor";
export const USER_READER_ROLE = "reader";
export const USER_ROLES = [
  USER_ADMIN_ROLE,
  USER_EDITOR_ROLE,
  USER_READER_ROLE,
] as const;

export const ITERATION_RUNNING_STATUS = "running";
export const ITERATION_PROPOSED_STATUS = "proposed";
export const ITERATION_APPLIED_STATUS = "applied";
export const ITERATION_REJECTED_STATUS = "rejected";
export const ITERATION_FAILED_STATUS = "failed";
export const ITERATION_STATUSES = [
  ITERATION_RUNNING_STATUS,
  ITERATION_PROPOSED_STATUS,
  ITERATION_APPLIED_STATUS,
  ITERATION_REJECTED_STATUS,
  ITERATION_FAILED_STATUS,
] as const;
export type IterationStatus = (typeof ITERATION_STATUSES)[number];

export const ITERATION_IDLE_STATUS = "idle";
export type IterationRunnerStatus =
  | typeof ITERATION_IDLE_STATUS
  | IterationStatus;

const ITERATION_TERMINAL_STATUSES = [
  ITERATION_APPLIED_STATUS,
  ITERATION_REJECTED_STATUS,
  ITERATION_FAILED_STATUS,
] as const satisfies readonly IterationStatus[];

export const ITERATION_RUNNER_TERMINAL_STATUSES = [
  ITERATION_IDLE_STATUS,
  ...ITERATION_TERMINAL_STATUSES,
] as const satisfies readonly IterationRunnerStatus[];

export function isIterationStatus(value: string): value is IterationStatus {
  return (ITERATION_STATUSES as readonly string[]).includes(value);
}

export const ITEM_TIERS = ["featured", "p1", "all", "excluded"] as const;
export type ItemTier = (typeof ITEM_TIERS)[number];

export const VISIBLE_ITEM_TIERS = [
  "featured",
  "p1",
  "all",
] as const satisfies readonly ItemTier[];
export type VisibleItemTier = (typeof VISIBLE_ITEM_TIERS)[number];

export const HIGHLIGHT_ITEM_TIERS = [
  "featured",
  "p1",
] as const satisfies readonly VisibleItemTier[];
export type HighlightItemTier = (typeof HIGHLIGHT_ITEM_TIERS)[number];

export function isVisibleItemTier(
  value: string | null | undefined,
): value is VisibleItemTier {
  return (
    typeof value === "string" &&
    (VISIBLE_ITEM_TIERS as readonly string[]).includes(value)
  );
}

export function isHighlightItemTier(
  value: string | null | undefined,
): value is HighlightItemTier {
  return (
    typeof value === "string" &&
    (HIGHLIGHT_ITEM_TIERS as readonly string[]).includes(value)
  );
}

export const FEED_VIEWS = ["today", "archive"] as const;
export type FeedView = (typeof FEED_VIEWS)[number];

export const SEARCH_MODES = ["lexical", "semantic"] as const;
export type SearchMode = (typeof SEARCH_MODES)[number];

export const FEEDBACK_VOTES = ["up", "down", "save"] as const;
export type FeedbackVote = (typeof FEEDBACK_VOTES)[number];

export const FEEDBACK_SIGNAL_VOTES = [
  "up",
  "down",
] as const satisfies readonly FeedbackVote[];
export type FeedbackSignalVote = (typeof FEEDBACK_SIGNAL_VOTES)[number];

export const FEEDBACK_SAVE_VOTE = "save" satisfies FeedbackVote;

export type Source = {
  id: string;
  name: { en: string; zh: string };
  url: string;
  kind: SourceKind;
  group: SourceGroup;
  locale: SourceLocale;
  cadence: Cadence;
  priority: 1 | 2 | 3;
  tags: string[];
  enabled: boolean;
  notes?: string;
  /** Surface in the "AX 严选 / curated" tab. Default false. */
  curated?: boolean;
  /** Source's items get tier floor of "all" regardless of scorer verdict —
   *  for pre-curated digests where their picks are pre-vetted. Default false. */
  neverExclude?: boolean;
};

export type Story = {
  id: string;
  /** Canonical source id (e.g. "dwarkesh-yt"). Used by filtered pages and by
   *  /api/v1/feed so callers can disambiguate two sources with the same
   *  publisher name (there are none today, but the field is load-bearing
   *  for per-source API queries). */
  sourceId: string;
  source: {
    publisher: string;
    /** Canonical source kind — UI translates via i18n (sources.kindFilter.*). */
    kindCode: SourceKind;
    /** Source content locale — UI translates via i18n (sources.localeFilter.*). */
    localeCode: SourceLocale;
    /** Source group — podcast/vendor-official/media/... Optional because
     *  only some pages (podcasts) care about it. */
    groupCode?: SourceGroup;
  };
  featured: boolean;
  title: string;
  summary: string;
  /** Canonical English tag IDs — UI translates via i18n (tags.*). */
  tags: string[];
  importance: number;
  tier: ItemTier;
  publishedAt: string; // ISO
  url: string;
  crossSourceCount?: number;
  locale: SourceLocale;
  /** Optional editor commentary — populated for featured/p1 items only. */
  editorNote?: string;
  /** Optional long-form analysis (markdown). */
  editorAnalysis?: string;
  /** LLM's reason for the tier/importance it assigned — shown as 精选理由 on featured cards. */
  reasoning?: string;
  /** HKR rubric — booleans for Happy / Knowledge / Resonance. Optional
   *  per-axis bilingual reasons populate chip tooltips + reasoning panel.
   *  Older rows (pre-reasons) omit reasonsZh/reasonsEn; UI falls back
   *  to the generic axis label. */
  hkr?: {
    h: boolean;
    k: boolean;
    r: boolean;
    reasonsZh?: { h: string; k: string; r: string };
    reasonsEn?: { h: string; k: string; r: string };
  };
  // ── Event-aggregation fields (populated when item belongs to a multi-member
  //    cluster; undefined for singletons which continue to render as today) ──
  /** Cluster DB id — used by the signal-drawer to fetch /api/v1/events/:id/members. */
  clusterId?: number;
  /** >= 1; undefined for singletons. member_count of the cluster. */
  coverage?: number;
  /** ISO — cluster.first_seen_at (inception day; archive anchor). */
  firstSeenAt?: string;
  /** ISO — cluster.latest_member_at (recency signal for Today view + still-developing badge). */
  latestMemberAt?: string;
  /** LLM-generated neutral canonical name, zh. Falls back to item's titleZh when absent. */
  canonicalTitleZh?: string;
  /** LLM-generated neutral canonical name, en. */
  canonicalTitleEn?: string;
  /** Derived server-side: firstSeenAt < today AND latestMemberAt > now-hotWindow. */
  stillDeveloping?: boolean;
  /** Optional — populated by /api/v1/events/:id/members only, never eager. */
  members?: Array<{
    sourceId: string;
    sourceName: string;
    title: string;
    url: string;
    publishedAt: string;
    importance: number;
  }>;
};

export type FeedbackEntry = {
  id: string;
  verdict: FeedbackSignalVote;
  title: string;
  note: string;
  createdAt: string; // ISO
};

export type IterationConsoleLine = {
  kind: "info" | "reading" | "done" | "success";
  key: string;
  params?: Record<string, string | number>;
};

export type DiffLine =
  | { kind: "add"; content: string }
  | { kind: "remove"; content: string }
  | { kind: "context"; content: string }
  | { kind: "meta"; content: string };
