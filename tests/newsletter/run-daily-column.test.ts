import { describe, expect, it } from "bun:test";
import { normalizeFeaturedItemIds } from "@/workers/newsletter/run-daily-column";

describe("normalizeFeaturedItemIds", () => {
  const rows = [{ id: 10 }, { id: 11 }, { id: 12 }, { id: 13 }];

  it("uses model-selected IDs when they belong to the selected pool", () => {
    expect(normalizeFeaturedItemIds([12, 10], rows)).toEqual([12, 10]);
  });

  it("drops IDs outside the selected pool and dedupes", () => {
    expect(normalizeFeaturedItemIds([99, 12, 12, 11], rows)).toEqual([12, 11]);
  });

  it("falls back to the first selected rows when the model returns none", () => {
    expect(normalizeFeaturedItemIds([], rows)).toEqual([10, 11, 12]);
  });

  it("falls back when every model ID is invalid", () => {
    expect(normalizeFeaturedItemIds([99, 100], rows)).toEqual([10, 11, 12]);
  });

  it("caps featured IDs at three", () => {
    expect(normalizeFeaturedItemIds([10, 11, 12, 13], rows)).toEqual([
      10,
      11,
      12,
    ]);
  });
});
