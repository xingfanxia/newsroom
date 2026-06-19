import { describe, expect, test } from "bun:test";
import {
  coerceSourcePreset,
  DEFAULT_SOURCE_PRESET,
  SOURCE_PRESET_LABELS,
  SOURCE_PRESETS,
  sourcePresetToFeedFilter,
} from "@/lib/feed/source-presets";

describe("feed source presets", () => {
  test("keeps preset ordering, labels, and default in one contract", () => {
    expect(SOURCE_PRESETS).toEqual([
      "all",
      "official",
      "newsletter",
      "media",
      "x",
      "research",
    ]);
    expect(DEFAULT_SOURCE_PRESET).toBe("all");
    expect(SOURCE_PRESET_LABELS.official).toEqual({
      en: "official",
      zh: "官网",
    });
  });

  test("coerces unknown route params to the default", () => {
    expect(coerceSourcePreset("media")).toBe("media");
    expect(coerceSourcePreset("unknown")).toBe(DEFAULT_SOURCE_PRESET);
    expect(coerceSourcePreset(undefined)).toBe(DEFAULT_SOURCE_PRESET);
  });

  test("maps presets to feed query filters", () => {
    expect(sourcePresetToFeedFilter("all")).toEqual({});
    expect(sourcePresetToFeedFilter("official")).toEqual({
      sourceGroup: "vendor-official",
    });
    expect(sourcePresetToFeedFilter("x")).toEqual({ sourceKind: "x-api" });
  });
});
