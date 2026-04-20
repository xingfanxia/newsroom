export type Locale = "zh" | "en";

export type SourceKind =
  | "rss"
  | "atom"
  | "api"
  | "rsshub"
  | "scrape"
  | "x-api";
export type SourceGroup =
  | "vendor-official"
  | "media"
  | "newsletter"
  | "research"
  | "social"
  | "product"
  | "podcast"
  | "policy"
  | "market";
export type Cadence = "live" | "hourly" | "daily" | "weekly";

export type Source = {
  id: string;
  name: { en: string; zh: string };
  url: string;
  kind: SourceKind;
  group: SourceGroup;
  locale: "en" | "zh" | "multi";
  cadence: Cadence;
  priority: 1 | 2 | 3;
  tags: string[];
  enabled: boolean;
  notes?: string;
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
    localeCode: "en" | "zh" | "multi";
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
  tier: "featured" | "all" | "p1" | "excluded";
  publishedAt: string; // ISO
  url: string;
  crossSourceCount?: number;
  locale: "en" | "zh" | "multi";
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
};

export type FeedbackEntry = {
  id: string;
  verdict: "up" | "down";
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

