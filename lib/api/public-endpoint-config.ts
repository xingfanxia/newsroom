export type RateLimitConfig = Readonly<{
  /** Distinguishes endpoint families so they each get their own bucket. */
  family: string;
  windowMs: number;
  max: number;
}>;

export type PublicCacheConfig = Readonly<{
  sMaxAge: number;
  staleWhileRevalidate: number;
}>;

export const PUBLIC_RATE_LIMIT_WINDOW_MS = 60_000;

export const PUBLIC_CACHE_DEFAULT = {
  sMaxAge: 60,
  staleWhileRevalidate: 300,
} satisfies PublicCacheConfig;

type PublicEndpointConfig = Readonly<{
  rateLimit: RateLimitConfig;
  cache: PublicCacheConfig;
}>;

export const PUBLIC_ENDPOINTS = {
  feed: {
    rateLimit: {
      family: "public-feed",
      windowMs: PUBLIC_RATE_LIMIT_WINDOW_MS,
      max: 600,
    },
    cache: PUBLIC_CACHE_DEFAULT,
  },
  item: {
    rateLimit: {
      family: "public-items",
      windowMs: PUBLIC_RATE_LIMIT_WINDOW_MS,
      max: 600,
    },
    cache: {
      sMaxAge: 120,
      staleWhileRevalidate: 600,
    },
  },
  eventMembers: {
    rateLimit: {
      family: "public-events",
      windowMs: PUBLIC_RATE_LIMIT_WINDOW_MS,
      max: 600,
    },
    cache: {
      sMaxAge: 180,
      staleWhileRevalidate: 900,
    },
  },
  search: {
    rateLimit: {
      family: "public-search",
      windowMs: PUBLIC_RATE_LIMIT_WINDOW_MS,
      max: 120,
    },
    cache: PUBLIC_CACHE_DEFAULT,
  },
  sources: {
    rateLimit: {
      family: "public-sources",
      windowMs: PUBLIC_RATE_LIMIT_WINDOW_MS,
      max: 300,
    },
    cache: {
      sMaxAge: 300,
      staleWhileRevalidate: 3600,
    },
  },
  daily: {
    rateLimit: {
      family: "public-daily",
      windowMs: PUBLIC_RATE_LIMIT_WINDOW_MS,
      max: 300,
    },
    cache: {
      sMaxAge: 300,
      staleWhileRevalidate: 86_400,
    },
  },
  dailyByDate: {
    rateLimit: {
      family: "public-daily",
      windowMs: PUBLIC_RATE_LIMIT_WINDOW_MS,
      max: 300,
    },
    cache: {
      sMaxAge: 3600,
      staleWhileRevalidate: 86_400,
    },
  },
  dailies: {
    rateLimit: {
      family: "public-dailies",
      windowMs: PUBLIC_RATE_LIMIT_WINDOW_MS,
      max: 300,
    },
    cache: {
      sMaxAge: 300,
      staleWhileRevalidate: 3600,
    },
  },
} as const satisfies Record<string, PublicEndpointConfig>;

export type PublicEndpointKey = keyof typeof PUBLIC_ENDPOINTS;

export const PUBLIC_ENDPOINT_COUNT = Object.keys(PUBLIC_ENDPOINTS).length;

export const PUBLIC_RATE_LIMIT_DEFAULT = {
  family: "public-default",
  windowMs: PUBLIC_RATE_LIMIT_WINDOW_MS,
  max: PUBLIC_ENDPOINTS.feed.rateLimit.max,
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
  keys: readonly PublicEndpointKey[];
  skillEndpoints: readonly string[];
  docsEndpoints: readonly string[];
  uiEndpoints: readonly string[];
}[];

export function publicRateLimitConfig(
  key: PublicEndpointKey,
): RateLimitConfig {
  return PUBLIC_ENDPOINTS[key].rateLimit;
}

export function publicCacheConfig(key: PublicEndpointKey): PublicCacheConfig {
  return PUBLIC_ENDPOINTS[key].cache;
}

export function publicRateLimitLabel(key: PublicEndpointKey): string {
  return `${PUBLIC_ENDPOINTS[key].rateLimit.max} r/min`;
}

export function publicRateLimitReqLabel(key: PublicEndpointKey): string {
  return `${PUBLIC_ENDPOINTS[key].rateLimit.max} req/min`;
}

export function publicRateLimitPerIpLabel(key: PublicEndpointKey): string {
  return `${PUBLIC_ENDPOINTS[key].rateLimit.max}/min/IP`;
}

export function publicCacheHeaderLabel(key: PublicEndpointKey): string {
  const cache = PUBLIC_ENDPOINTS[key].cache;
  return `s-maxage=${cache.sMaxAge}, stale-while-revalidate=${cache.staleWhileRevalidate}`;
}
