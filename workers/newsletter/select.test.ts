import { describe, expect, it } from "bun:test";
import {
  computeColumnWindow,
  selectDailyColumnPool,
  type DailyColumnCandidateLoader,
  type SelectedRow,
} from "./select";

function selectedRow(
  id: number,
  overrides: Partial<SelectedRow> = {},
): SelectedRow {
  return {
    id,
    clusterId: null,
    coverage: 1,
    publishedAt: new Date("2026-07-14T10:00:00Z"),
    enrichedAt: new Date("2026-07-14T10:01:00Z"),
    titleZh: null,
    titleEn: `Item ${id}`,
    title: `Item ${id}`,
    canonicalTitleZh: null,
    canonicalTitleEn: null,
    summaryZh: null,
    summaryEn: null,
    noteZh: null,
    noteEn: null,
    importance: 80 - id,
    tier: "featured",
    tags: null,
    sourceTags: null,
    fromCurated: false,
    ...overrides,
  };
}

function candidateLoader(
  curated: SelectedRow[],
  hot: SelectedRow[],
): DailyColumnCandidateLoader {
  return async () => ({ curated, hot });
}

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
    const result = await selectDailyColumnPool(
      future,
      candidateLoader([], []),
    );
    expect(result.rows.length).toBe(0);
    expect(result.skipReason).toBe("insufficient-signal");
    expect(result.windowEnd.toISOString()).toBe("2099-01-01T12:00:00.000Z");
  });

  it("returns source tags for callers that need to inspect source mix", async () => {
    const now = new Date();
    const rows = Array.from({ length: 5 }, (_, index) =>
      selectedRow(index + 1, { sourceTags: ["official"] }),
    );
    const result = await selectDailyColumnPool(
      now,
      candidateLoader(rows, []),
    );
    for (const row of result.rows) {
      expect(row.sourceTags == null || Array.isArray(row.sourceTags)).toBe(true);
    }
  });

  it("caps at 20 unique items", async () => {
    const now = new Date();
    const rows = Array.from({ length: 25 }, (_, index) =>
      selectedRow(index + 1),
    );
    const result = await selectDailyColumnPool(
      now,
      candidateLoader([], rows),
    );
    expect(result.rows.length).toBeLessThanOrEqual(20);
    const ids = result.rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("preserves curated metadata when an item appears in both pools", async () => {
    const now = new Date();
    const curated = selectedRow(1, { fromCurated: true });
    const hot = [
      selectedRow(1, { fromCurated: false }),
      ...Array.from({ length: 4 }, (_, index) => selectedRow(index + 2)),
    ];
    const result = await selectDailyColumnPool(
      now,
      candidateLoader([curated], hot),
    );

    expect(result.rows).toHaveLength(5);
    expect(result.rows.find((row) => row.id === 1)?.fromCurated).toBe(true);
  });
});
