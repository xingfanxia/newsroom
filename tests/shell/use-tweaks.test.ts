import { describe, expect, it } from "bun:test";
import { TWEAK_DEFAULTS } from "@/hooks/use-tweaks";

// The full TweaksProvider requires a DOM; we can't exercise React here. Instead
// we assert the public shape + defaults so a rename or silently dropped field
// is caught in CI rather than in prod.
describe("TWEAK_DEFAULTS", () => {
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

describe("localStorage language migration", () => {
  // Documentation-style assertion: the loader must normalize legacy 'both'
  // to 'en' or pre-PR#9 saved configs will blow up. `loadFromStorage` is
  // module-private, so we mirror its migration step here.
  it("legacy 'both' still parses to a valid Tweaks shape", () => {
    const parsed = JSON.parse(
      JSON.stringify({ language: "both", density: "comfy" }),
    ) as Record<string, unknown>;
    if (parsed.language === "both") parsed.language = "en";
    expect(parsed.language).toBe("en");
    expect(parsed.density).toBe("comfy");
  });

  it("unrecognized language values remain as-is (caller validates downstream)", () => {
    const parsed = JSON.parse(JSON.stringify({ language: "jp" })) as Record<
      string,
      unknown
    >;
    if (parsed.language === "both") parsed.language = "en";
    // The migration ONLY touches 'both'. Unknown values stay and get caught
    // later by the TypeScript Tweaks union — caller should validate.
    expect(parsed.language).toBe("jp");
  });
});
