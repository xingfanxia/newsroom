import { describe, expect, test } from "bun:test";
import {
  buildTweaksDbPatch,
  tweaksPatchBodySchema,
} from "@/lib/api/tweak-requests";

describe("tweak request schemas", () => {
  test("accepts partial tweak updates and full-replace watchlists", () => {
    const parsed = tweaksPatchBodySchema.parse({
      tweaks: {
        accent: "cyan",
        density: "reader",
        showTicker: false,
      },
      watchlist: ["gpt-6", "agentic ide"],
    });

    expect(parsed).toEqual({
      tweaks: {
        accent: "cyan",
        density: "reader",
        showTicker: false,
      },
      watchlist: ["gpt-6", "agentic ide"],
    });
  });

  test("rejects invalid tweak values and unsafe watchlist payloads", () => {
    expect(
      tweaksPatchBodySchema.safeParse({ tweaks: { accent: "beige" } }).success,
    ).toBe(false);
    expect(
      tweaksPatchBodySchema.safeParse({ watchlist: ["x".repeat(65)] }).success,
    ).toBe(false);
    expect(
      tweaksPatchBodySchema.safeParse({
        watchlist: Array.from({ length: 25 }, (_, i) => `term-${i}`),
      }).success,
    ).toBe(false);
  });

  test("builds a DB patch only when the body mutates server state", () => {
    expect(buildTweaksDbPatch({})).toBeNull();

    const patch = buildTweaksDbPatch({
      tweaks: { language: "zh" },
      watchlist: [],
    });
    expect(patch?.updatedAt).toBeInstanceOf(Date);
    expect(patch?.tweaks).toEqual({ language: "zh" });
    expect(patch?.watchlist).toEqual([]);
  });
});
