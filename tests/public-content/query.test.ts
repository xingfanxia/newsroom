import { describe, expect, test } from "bun:test";
import { canonicalPublicStateSha256 } from "@/lib/public-content/canonical";
import {
  getPublicEventMembers,
  queryPublicFeed,
} from "@/lib/public-content/query";
import {
  EXPECTED_QUERY_IDS,
  PARITY_NOW_MS,
  PARITY_STATE,
  PARITY_STATE_SHA256,
} from "./fixtures/parity-corpus";

function ids(query: Parameters<typeof queryPublicFeed>[1] = {}): number[] {
  return queryPublicFeed(PARITY_STATE, query, { nowMs: PARITY_NOW_MS }).items.map(
    (story) => Number(story.id),
  );
}

describe("pure public feed query", () => {
  test("uses a hash-frozen independent canonical corpus", async () => {
    expect(await canonicalPublicStateSha256(PARITY_STATE)).toBe(
      PARITY_STATE_SHA256,
    );
  });

  test("preserves inclusive tiers and canonical event-lead dedup", () => {
    expect(ids({ tier: "all" })).toEqual(EXPECTED_QUERY_IDS.all);
    expect(ids({ tier: "featured" })).toEqual(EXPECTED_QUERY_IDS.featured);
    expect(ids({ tier: "p1" })).toEqual(EXPECTED_QUERY_IDS.p1);

    const knownWrongFeaturedExact = ids({ tier: "all" }).filter((id) => {
      const item = PARITY_STATE.items.find((entry) => entry.id === id)!;
      const event = PARITY_STATE.events.find((entry) => entry.id === item.eventId);
      return (event?.tier ?? item.tier) === "featured";
    });
    expect(knownWrongFeaturedExact).not.toEqual(EXPECTED_QUERY_IDS.featured);

    const knownWrongAllRows = PARITY_STATE.items
      .filter((entry) => String(entry.tier) !== "excluded")
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .map(({ id }) => id);
    expect(knownWrongAllRows).not.toEqual(EXPECTED_QUERY_IDS.all);
    expect(knownWrongAllRows).toContain(2);
    expect(knownWrongAllRows).toContain(6);
  });

  test("localizes event stories without raw reasoning", () => {
    const zh = queryPublicFeed(PARITY_STATE, { tier: "featured", locale: "zh" }, {
      nowMs: PARITY_NOW_MS,
    }).items[0]!;
    const en = queryPublicFeed(PARITY_STATE, { tier: "featured", locale: "en" }, {
      nowMs: PARITY_NOW_MS,
    }).items[0]!;

    expect(zh).toMatchObject({
      id: "1",
      title: "Alpha 事件",
      summary: "Alpha 摘要",
      importance: 95,
      tier: "featured",
      coverage: 2,
      crossSourceCount: 1,
      reasoning: "精选 · 重要度 95 · 吸引力 + 知识量",
      stillDeveloping: true,
    });
    expect(en).toMatchObject({
      id: "1",
      title: "Alpha event",
      summary: "Alpha summary",
      source: { publisher: "Alpha Podcast" },
      reasoning: "Featured · importance 95 · hook + knowledge",
    });
    expect(JSON.stringify(zh)).not.toContain("reasonsZh");
  });

  test("gives exact source id precedence over group and kind", () => {
    const query = {
      tier: "all" as const,
      sourceId: "beta-x",
      sourceGroup: "podcast" as const,
      sourceKind: "rss" as const,
    };
    expect(ids(query)).toEqual(EXPECTED_QUERY_IDS.sourcePrecedence);

    const knownWrongAndAllFilters = PARITY_STATE.items.filter((entry) => {
      const source = PARITY_STATE.sources.find(({ id }) => id === entry.sourceId)!;
      return (
        entry.sourceId === query.sourceId &&
        source.group === query.sourceGroup &&
        source.kind === query.sourceKind
      );
    });
    expect(knownWrongAndAllFilters).toHaveLength(0);
  });

  test("filters source metadata, dates and exclusive ranges", () => {
    expect(ids({ tier: "all", curatedOnly: true })).toEqual(
      EXPECTED_QUERY_IDS.curated,
    );
    expect(ids({ tier: "all", includeSourceTags: ["preferred"] })).toEqual(
      EXPECTED_QUERY_IDS.includePreferred,
    );
    expect(ids({ tier: "all", excludeSourceTags: ["blocked"] })).toEqual(
      EXPECTED_QUERY_IDS.excludeBlocked,
    );
    expect(ids({ tier: "all", date: "2026-07-13" })).toEqual(
      EXPECTED_QUERY_IDS.dateJuly13,
    );
    expect(
      ids({
        tier: "all",
        dateFrom: "2026-07-13T21:00:00.000Z",
        dateTo: "2026-07-14T10:00:00.000Z",
      }),
    ).toEqual(EXPECTED_QUERY_IDS.range);
    const knownWrongInclusiveUpper = ids({
      tier: "all",
      dateFrom: "2026-07-13T21:00:00.000Z",
      dateTo: "2026-07-14T10:00:00.001Z",
    });
    expect(knownWrongInclusiveUpper).not.toEqual(EXPECTED_QUERY_IDS.range);
  });

  test("matches SQLite LIKE percent/underscore wildcards with ASCII folding", () => {
    expect(ids({ tier: "all", searchText: "a_00" })).toEqual(
      EXPECTED_QUERY_IDS.wildcard,
    );
    const knownWrongLiteral = PARITY_STATE.items
      .filter((entry) =>
        [entry.title.raw, entry.title.zh, entry.title.en]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes("a_00")),
      )
      .map(({ id }) => id);
    expect(knownWrongLiteral).not.toEqual(EXPECTED_QUERY_IDS.wildcard);
  });

  test("uses the injected clock for today, recency rescue and day caps", () => {
    expect(ids({ tier: "all", view: "today" })).toEqual(
      EXPECTED_QUERY_IDS.today,
    );
    expect(
      ids({ tier: "all", minImportance: 90, recentDayRescueDays: 2 }),
    ).toEqual(EXPECTED_QUERY_IDS.rescued);
    expect(ids({ tier: "all", recencyFloorDays: 2 })).toEqual(
      EXPECTED_QUERY_IDS.recencyFloor,
    );
    expect(ids({ tier: "all", limit: 4, maxPerDay: 1 })).toEqual(
      EXPECTED_QUERY_IDS.onePerDay,
    );
    expect(ids({ tier: "all", limit: 0, maxPerDay: 1 })).toEqual([]);
  });

  test("keeps total independent from offset/limit and exposes event members", () => {
    const page = queryPublicFeed(
      PARITY_STATE,
      { tier: "all", offset: 2, limit: 3 },
      { nowMs: PARITY_NOW_MS },
    );
    expect(page.items.map(({ id }) => Number(id))).toEqual([8, 10, 4]);
    expect(page.total).toBe(EXPECTED_QUERY_IDS.all.length);
    expect(getPublicEventMembers(PARITY_STATE, 100, "en").map((row) => row.sourceId)).toEqual([
      "beta-x",
      "alpha-podcast",
    ]);
  });

  test("fails closed on unknown schema versions and private fields", () => {
    expect(() =>
      queryPublicFeed({ ...PARITY_STATE, schemaVersion: 2 }, { tier: "all" }, {
        nowMs: PARITY_NOW_MS,
      }),
    ).toThrow();
    expect(() =>
      queryPublicFeed(
        {
          ...PARITY_STATE,
          items: [{ ...PARITY_STATE.items[0], reasoning: "PRIVATE" }, ...PARITY_STATE.items.slice(1)],
        },
        { tier: "all" },
        { nowMs: PARITY_NOW_MS },
      ),
    ).toThrow();
  });
});
