export type RateLimitConfig = {
  /** Distinguishes endpoint families so they each get their own bucket. */
  family: string;
  windowMs: number;
  max: number;
};

export const PUBLIC_RATE_LIMIT_WINDOW_MS = 60_000;

export const PUBLIC_RATE_LIMITS = {
  feed: {
    family: "public-feed",
    windowMs: PUBLIC_RATE_LIMIT_WINDOW_MS,
    max: 600,
  },
  item: {
    family: "public-items",
    windowMs: PUBLIC_RATE_LIMIT_WINDOW_MS,
    max: 600,
  },
  eventMembers: {
    family: "public-events",
    windowMs: PUBLIC_RATE_LIMIT_WINDOW_MS,
    max: 600,
  },
  search: {
    family: "public-search",
    windowMs: PUBLIC_RATE_LIMIT_WINDOW_MS,
    max: 120,
  },
  sources: {
    family: "public-sources",
    windowMs: PUBLIC_RATE_LIMIT_WINDOW_MS,
    max: 300,
  },
  daily: {
    family: "public-daily",
    windowMs: PUBLIC_RATE_LIMIT_WINDOW_MS,
    max: 300,
  },
  dailyByDate: {
    family: "public-daily",
    windowMs: PUBLIC_RATE_LIMIT_WINDOW_MS,
    max: 300,
  },
  dailies: {
    family: "public-dailies",
    windowMs: PUBLIC_RATE_LIMIT_WINDOW_MS,
    max: 300,
  },
} as const satisfies Record<string, RateLimitConfig>;

export type PublicRateLimitKey = keyof typeof PUBLIC_RATE_LIMITS;

export const PUBLIC_RATE_LIMIT_DEFAULT = {
  family: "public-default",
  windowMs: PUBLIC_RATE_LIMIT_WINDOW_MS,
  max: PUBLIC_RATE_LIMITS.feed.max,
} satisfies RateLimitConfig;

export const PUBLIC_RATE_LIMIT_DOC_GROUPS = [
  {
    keys: ["feed", "item", "eventMembers"],
    skillEndpoints: [
      "`/api/public/feed`",
      "`/api/public/items/{id}`",
      "`/api/public/events/{id}/members`",
    ],
    docsEndpoints: [
      "GET /feed",
      "GET /items/{id}",
      "GET /events/{cluster_id}/members",
    ],
    uiEndpoints: ["/feed", "/items/{id}", "/events/{id}/members"],
  },
  {
    keys: ["search"],
    skillEndpoints: ["`/api/public/search` (有 LLM 成本 / has LLM cost)"],
    docsEndpoints: ["GET /search"],
    uiEndpoints: ["/search (LLM cost)"],
  },
  {
    keys: ["daily", "dailyByDate", "dailies", "sources"],
    skillEndpoints: [
      "`/api/public/daily`",
      "`/api/public/daily/{YYYY-MM-DD}`",
      "`/api/public/dailies`",
      "`/api/public/sources`",
    ],
    docsEndpoints: [
      "GET /daily",
      "GET /daily/{YYYY-MM-DD}",
      "GET /dailies",
      "GET /sources",
    ],
    uiEndpoints: ["/daily{,/[date]}", "/dailies", "/sources"],
  },
] as const satisfies readonly {
  keys: readonly PublicRateLimitKey[];
  skillEndpoints: readonly string[];
  docsEndpoints: readonly string[];
  uiEndpoints: readonly string[];
}[];

export function publicRateLimitConfig(
  key: PublicRateLimitKey,
): RateLimitConfig {
  return PUBLIC_RATE_LIMITS[key];
}

export function publicRateLimitLabel(key: PublicRateLimitKey): string {
  return `${PUBLIC_RATE_LIMITS[key].max} r/min`;
}

export function publicRateLimitReqLabel(key: PublicRateLimitKey): string {
  return `${PUBLIC_RATE_LIMITS[key].max} req/min`;
}

export function publicRateLimitPerIpLabel(key: PublicRateLimitKey): string {
  return `${PUBLIC_RATE_LIMITS[key].max}/min/IP`;
}
