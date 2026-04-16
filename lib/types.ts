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
    kindLabel: string; // "Research (发表成果·网页)" verbatim
  };
  featured: boolean;
  title: string;
  summary: string;
  tags: string[];
  importance: number;
  tier: "featured" | "all" | "p1" | "excluded";
  publishedAt: string; // ISO
  url: string;
  crossSourceCount?: number;
  locale: "en" | "zh" | "multi";
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
