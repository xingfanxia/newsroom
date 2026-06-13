import type { FeedQuery } from "@/lib/items/live";

const SOURCE_PRESETS = [
  "all",
  "official",
  "newsletter",
  "media",
  "x",
  "research",
] as const;

export type SourcePreset = (typeof SOURCE_PRESETS)[number];

type FeedSourceFilter = Pick<FeedQuery, "sourceGroup" | "sourceKind">;

export function coerceSourcePreset(value: string | undefined): SourcePreset {
  return SOURCE_PRESETS.includes(value as SourcePreset)
    ? (value as SourcePreset)
    : "all";
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
