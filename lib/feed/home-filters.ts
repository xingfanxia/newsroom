import {
  HIGHLIGHT_ITEM_TIERS,
  isHighlightItemTier,
  type HighlightItemTier,
} from "@/lib/types";

export const HOME_TIERS = HIGHLIGHT_ITEM_TIERS;
export type HomeTier = HighlightItemTier;
export const DEFAULT_HOME_TIER = HOME_TIERS[0];

const HOME_VIEWS = ["today", "daily"] as const;
export type HomeView = (typeof HOME_VIEWS)[number];
export const DEFAULT_HOME_VIEW = HOME_VIEWS[0];

const HOME_VIEW_SET = new Set<string>(HOME_VIEWS);

export function coerceHomeTier(value: string | null | undefined): HomeTier {
  return value && isHighlightItemTier(value) ? value : DEFAULT_HOME_TIER;
}

export function coerceHomeView(value: string | null | undefined): HomeView {
  return value && HOME_VIEW_SET.has(value)
    ? (value as HomeView)
    : DEFAULT_HOME_VIEW;
}
