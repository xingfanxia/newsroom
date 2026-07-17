import type { AppLocale } from "@/lib/types";

export const DEFAULT_UI_EVENT_MEMBERS_LOCALE = "zh" satisfies AppLocale;
export const DEFAULT_V1_EVENT_MEMBERS_LOCALE =
  DEFAULT_UI_EVENT_MEMBERS_LOCALE;
export const DEFAULT_PUBLIC_EVENT_MEMBERS_LOCALE = "en" satisfies AppLocale;
export const DEFAULT_MCP_EVENT_MEMBERS_LOCALE =
  DEFAULT_PUBLIC_EVENT_MEMBERS_LOCALE;

// A malformed/over-merged cluster must not fan one detail request out across
// an unbounded number of DB rows or R2 item shards.
export const EVENT_MEMBERS_LIMIT_MAX = 200;
