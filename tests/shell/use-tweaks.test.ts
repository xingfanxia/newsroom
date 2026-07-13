import { describe, expect, it } from "bun:test";
import {
  parsePersistedTweaks,
  persistableTweaks,
  resolveTweaks,
  TWEAK_DEFAULTS,
  TWEAK_LANGUAGES,
  type Tweaks,
} from "@/lib/tweaks";
import { APP_LOCALES } from "@/lib/types";

// This file covers the pure tweak helpers (shape / defaults / resolve /
// validate / persist). The DOM-bound TweaksProvider React behavior is exercised
// separately in tweaks-provider.test.tsx (happy-dom).
describe("TWEAK_DEFAULTS", () => {
  it("uses the app locale tuple for tweak language options", () => {
    expect(TWEAK_LANGUAGES).toEqual(APP_LOCALES);
  });

  it("defaults to English (not legacy 'both')", () => {
    expect(TWEAK_DEFAULTS.language).toBe("en");
  });

  it("defaults to midnight theme with green accent", () => {
    expect(TWEAK_DEFAULTS.theme).toBe("midnight");
    expect(TWEAK_DEFAULTS.accent).toBe("green");
  });

  it("defaults to compact density", () => {
    expect(TWEAK_DEFAULTS.density).toBe("compact");
  });

  it("defaults to sharp corners", () => {
    expect(TWEAK_DEFAULTS.radius).toBe("sharp");
  });

  it("defaults to terminal chrome + ring score", () => {
    expect(TWEAK_DEFAULTS.chromeStyle).toBe("terminal");
    expect(TWEAK_DEFAULTS.scoreStyle).toBe("ring");
  });

  it("defaults to showing ticker + radar + pulse + breadcrumb", () => {
    expect(TWEAK_DEFAULTS.showTicker).toBe(true);
    expect(TWEAK_DEFAULTS.showRadar).toBe(true);
    expect(TWEAK_DEFAULTS.showPulse).toBe(true);
    expect(TWEAK_DEFAULTS.showBreadcrumb).toBe(true);
  });

  it("defaults to muted metadata on, line numbers off", () => {
    expect(TWEAK_DEFAULTS.mutedMeta).toBe(true);
    expect(TWEAK_DEFAULTS.showLineNumbers).toBe(false);
  });

  it("exposes all 15 config keys", () => {
    const keys = Object.keys(TWEAK_DEFAULTS);
    expect(keys).toHaveLength(15);
    const expected = [
      "density",
      "accent",
      "theme",
      "monoFont",
      "cjkFont",
      "radius",
      "chromeStyle",
      "scoreStyle",
      "showTicker",
      "showRadar",
      "showPulse",
      "showBreadcrumb",
      "showLineNumbers",
      "mutedMeta",
      "language",
    ];
    for (const k of expected) expect(keys).toContain(k);
  });
});

describe("resolveTweaks — language follows the URL locale, never storage", () => {
  // The bug this guards: a persisted language "zh" overriding an "/en" URL
  // desynced Chinese chrome from English (URL-locale) titles. `language` must
  // always equal the URL locale; every other tweak still persists.
  it("forces language to the URL locale even when storage disagrees", () => {
    const r = resolveTweaks("en", { language: "zh", theme: "paper" });
    expect(r.language).toBe("en");
    expect(r.theme).toBe("paper"); // non-language overrides still apply
  });

  it("applies non-language overrides local-then-server (last wins)", () => {
    const r = resolveTweaks(
      "zh",
      { density: "comfy", accent: "blue" },
      { accent: "red" },
    );
    expect(r.language).toBe("zh");
    expect(r.density).toBe("comfy");
    expect(r.accent).toBe("red");
  });

  it("ignores null/undefined overrides and drops legacy 'both'", () => {
    const r = resolveTweaks(
      "zh",
      null,
      { language: "both" as unknown as Tweaks["language"] },
      undefined,
    );
    expect(r.language).toBe("zh");
  });

  it("with no overrides returns the defaults carrying the URL locale", () => {
    expect(resolveTweaks("zh")).toEqual({ ...TWEAK_DEFAULTS, language: "zh" });
    expect(resolveTweaks("en")).toEqual(TWEAK_DEFAULTS);
  });
});

describe("parsePersistedTweaks — tolerant runtime validation of stored blobs", () => {
  it("keeps a fully valid blob unchanged", () => {
    const valid: Tweaks = { ...TWEAK_DEFAULTS, theme: "paper", accent: "blue" };
    expect(parsePersistedTweaks(valid)).toEqual(valid);
  });

  it("drops individual invalid fields, keeping the valid ones", () => {
    const r = parsePersistedTweaks({
      theme: "neon", // not a TWEAK_THEME → dropped
      accent: "blue", // valid → kept
      density: 42, // wrong type → dropped
      mutedMeta: false, // valid → kept
    });
    expect(r).toEqual({ accent: "blue", mutedMeta: false });
  });

  it("drops legacy language 'both' but keeps a valid locale", () => {
    expect(parsePersistedTweaks({ language: "both" })).toEqual({});
    expect(parsePersistedTweaks({ language: "zh" })).toEqual({
      language: "zh",
    });
  });

  it("ignores unknown keys", () => {
    expect(parsePersistedTweaks({ theme: "slate", bogusKey: 1 })).toEqual({
      theme: "slate",
    });
  });

  it("returns {} for non-object input", () => {
    expect(parsePersistedTweaks(null)).toEqual({});
    expect(parsePersistedTweaks(undefined)).toEqual({});
    expect(parsePersistedTweaks("nope")).toEqual({});
    expect(parsePersistedTweaks(7)).toEqual({});
  });
});

describe("persistableTweaks — strips the URL-derived language", () => {
  it("omits language and keeps every other field", () => {
    const persisted = persistableTweaks({ ...TWEAK_DEFAULTS, language: "zh" });
    expect("language" in persisted).toBe(false);
    const expectedKeys = Object.keys(TWEAK_DEFAULTS)
      .filter((k) => k !== "language")
      .sort();
    expect(Object.keys(persisted).sort()).toEqual(expectedKeys);
    for (const key of expectedKeys) {
      expect(persisted[key as keyof typeof persisted] as unknown).toBe(
        TWEAK_DEFAULTS[key as keyof Tweaks],
      );
    }
  });

  it("does not mutate its input", () => {
    const input: Tweaks = { ...TWEAK_DEFAULTS, language: "zh" };
    persistableTweaks(input);
    expect(input.language).toBe("zh");
  });
});
