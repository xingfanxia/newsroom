import type { PublicFeedQuery } from "@/lib/public-content/query";

export const SOURCE_PRESETS = [
  "all",
  "official",
  "newsletter",
  "media",
  "x",
  "research",
] as const;

export type SourcePreset = (typeof SOURCE_PRESETS)[number];
export const DEFAULT_SOURCE_PRESET = SOURCE_PRESETS[0];

export const SOURCE_PRESET_LABELS = {
  all: { en: "all", zh: "全部" },
  official: { en: "official", zh: "官网" },
  newsletter: { en: "newsletter", zh: "通讯" },
  media: { en: "media", zh: "媒体" },
  x: { en: "X", zh: "X" },
  research: { en: "research", zh: "研究" },
} as const satisfies Record<SourcePreset, { en: string; zh: string }>;

type FeedSourceFilter = Pick<PublicFeedQuery, "sourceGroup" | "sourceKind">;

const SOURCE_PRESET_SET = new Set<string>(SOURCE_PRESETS);

export function coerceSourcePreset(
  value: string | null | undefined,
): SourcePreset {
  return value && SOURCE_PRESET_SET.has(value)
    ? (value as SourcePreset)
    : DEFAULT_SOURCE_PRESET;
}

export function sourcePresetToFeedFilter(
  preset: SourcePreset,
): FeedSourceFilter {
  switch (preset) {
    case "official":
      return { sourceGroup: "vendor-official" };
    case "newsletter":
      return { sourceGroup: "newsletter" };
    case "media":
      return { sourceGroup: "media" };
    case "research":
      return { sourceGroup: "research" };
    case "x":
      return { sourceKind: "x-api" };
    default:
      return {};
  }
}
