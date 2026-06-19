import type { AppLocale, FeedView, VisibleItemTier } from "@/lib/types";

export const DEFAULT_FEED_TIER = "featured" satisfies VisibleItemTier;
export const DEFAULT_FEED_VIEW = "archive" satisfies FeedView;
export const DEFAULT_FEED_LIMIT = 40;
export const DEFAULT_FEED_OFFSET = 0;
export const DEFAULT_FEED_HOT_WINDOW_HOURS = 24;

export const DEFAULT_API_FEED_LOCALE = "en" satisfies AppLocale;
export const DEFAULT_STORY_FEED_LOCALE = "zh" satisfies AppLocale;
