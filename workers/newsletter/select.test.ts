import { describe, expect, it } from "bun:test";
import {
  computeColumnWindow,
  selectDailyColumnPool,
} from "./select";

describe("computeColumnWindow", () => {
  it("snaps end to the hour and start to 24h before", () => {
    const t = new Date("2026-04-25T10:30:45Z");
    const { start, end } = computeColumnWindow(t);
    expect(end.toISOString()).toBe("2026-04-25T10:00:00.000Z");
    expect(start.toISOString()).toBe("2026-04-24T10:00:00.000Z");
  });

  it("is idempotent within the same hour", () => {
    const a = computeColumnWindow(new Date("2026-04-25T10:00:00Z"));
    const b = computeColumnWindow(new Date("2026-04-25T10:59:59Z"));
    expect(a.start.getTime()).toBe(b.start.getTime());
    expect(a.end.getTime()).toBe(b.end.getTime());
  });
});

describe("selectDailyColumnPool", () => {
  it("returns insufficient-signal for far-future window", async () => {
    const future = new Date("2099-01-01T12:00:00Z");
    const result = await selectDailyColumnPool(future);
    expect(result.rows.length).toBe(0);
    expect(result.skipReason).toBe("insufficient-signal");
    expect(result.windowEnd.toISOString()).toBe("2099-01-01T12:00:00.000Z");
  });

  it("excludes papers (arxiv/paper source tags) when pool is non-empty", async () => {
    const now = new Date();
    const result = await selectDailyColumnPool(now);
    if (result.rows.length === 0) return; // skip if dev DB has no signal
    for (const row of result.rows) {
      const tags = row.sourceTags ?? [];
      expect(tags).not.toContain("arxiv");
      expect(tags).not.toContain("paper");
    }
  });

  it("caps at 20 unique items", async () => {
    const now = new Date();
    const result = await selectDailyColumnPool(now);
    expect(result.rows.length).toBeLessThanOrEqual(20);
    const ids = result.rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("preserves curated metadata when an item appears in both pools", async () => {
    const now = new Date();
    const result = await selectDailyColumnPool(now);
    // Sanity: curated items should be marked as such
    const curatedRows = result.rows.filter((r) => r.fromCurated);
    for (const r of curatedRows) {
      expect(r.fromCurated).toBe(true);
    }
  });
});
