import { describe, expect, test } from "bun:test";
import {
  buildTweaksDbPatch,
  tweaksPatchBodySchema,
} from "@/lib/api/tweak-requests";
import {
  addWatchlistTerm,
  normalizeWatchlist,
  removeWatchlistTerm,
} from "@/lib/watchlist";

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

  test("normalizes watchlists before they reach persistence", () => {
    const parsed = tweaksPatchBodySchema.parse({
      watchlist: [" GPT-6 ", "gpt-6", "Agentic IDE", "agentic ide", "   "],
    });

    expect(parsed.watchlist).toEqual(["gpt-6", "agentic ide"]);

    const patch = buildTweaksDbPatch(parsed);
    expect(patch?.watchlist).toEqual(["gpt-6", "agentic ide"]);
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

describe("watchlist helpers", () => {
  test("trim, lowercase, and dedupe terms case-insensitively", () => {
    expect(
      normalizeWatchlist([" GPT-6 ", "gpt-6", "Agentic IDE", "agentic ide"]),
    ).toEqual(["gpt-6", "agentic ide"]);
  });

  test("use the same normalization for add and remove flows", () => {
    expect(addWatchlistTerm(["gpt-6"], " GPT-6 ")).toEqual(["gpt-6"]);
    expect(addWatchlistTerm(["gpt-6"], " Agentic IDE ")).toEqual([
      "gpt-6",
      "agentic ide",
    ]);
    expect(removeWatchlistTerm(["gpt-6", "agentic ide"], " GPT-6 ")).toEqual([
      "agentic ide",
    ]);
  });
});
