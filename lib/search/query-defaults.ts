import type { AppLocale, SearchMode, VisibleItemTier } from "@/lib/types";

export const DEFAULT_SEARCH_MODE = "lexical" satisfies SearchMode;
export const DEFAULT_SEARCH_TIER = "all" satisfies VisibleItemTier;
export const DEFAULT_SEARCH_LIMIT = 20;
export const DEFAULT_SEARCH_OFFSET = 0 as const;
export const DEFAULT_SEARCH_SEMANTIC_INCLUDE_EXCLUDED = false;
export const PUBLIC_SEMANTIC_SEARCH_ERROR =
  "semantic_search_not_supported" as const;

export const SEARCH_LIMIT_MIN = 1;
export const SEARCH_QUERY_MAX_LENGTH = 256;
export const SEARCH_OFFSET_MAX = 100_000;
export const V1_SEARCH_LIMIT_MAX = 100;
export const PUBLIC_SEARCH_LIMIT_MAX = 50;
export const MCP_SEARCH_LIMIT_MAX = 100;

export const DEFAULT_API_SEARCH_LOCALE = "en" satisfies AppLocale;
