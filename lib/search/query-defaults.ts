import type { AppLocale, SearchMode, VisibleItemTier } from "@/lib/types";

export const DEFAULT_SEARCH_MODE = "lexical" satisfies SearchMode;
export const DEFAULT_SEARCH_TIER = "all" satisfies VisibleItemTier;
export const DEFAULT_SEARCH_LIMIT = 20;
export const DEFAULT_SEARCH_OFFSET = 0 as const;
export const DEFAULT_SEARCH_SEMANTIC_INCLUDE_EXCLUDED = false;

export const DEFAULT_API_SEARCH_LOCALE = "en" satisfies AppLocale;
