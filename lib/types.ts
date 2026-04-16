export type Locale = "zh" | "en";

export type SourceKind = "rss" | "atom" | "api" | "rsshub" | "scrape";
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
  source: {
    publisher: string;
    /** Canonical source kind — UI translates via i18n (sources.kindFilter.*). */
    kindCode: SourceKind;
    /** Source content locale — UI translates via i18n (sources.localeFilter.*). */
    localeCode: "en" | "zh" | "multi";
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

export type PolicyVersion = {
  version: string; // v1, v2, v3
  committedAt: string;
  feedbackCount: number;
};
