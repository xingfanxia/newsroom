import { describe, expect, test } from "bun:test";
import {
  feedQueryFromParams,
  parseCommaList,
  publicFeedQueryParamSchema,
  publicSearchQueryParamSchema,
  searchFeedQueryFromParams,
  v1FeedQueryParamSchema,
  v1SearchQueryParamSchema,
} from "@/lib/api/feed-query-params";
import { SOURCE_GROUPS, SOURCE_KINDS } from "@/lib/types";

describe("feed query param schemas", () => {
  test("share feed defaults while preserving v1/public limit ceilings", () => {
    const defaults = v1FeedQueryParamSchema.parse({});

    expect(defaults).toMatchObject({
      tier: "featured",
      view: "archive",
      hot_window_hours: 24,
      limit: 40,
      offset: 0,
      locale: "en",
      curated_only: false,
    });
    expect(v1FeedQueryParamSchema.safeParse({ limit: "500" }).success).toBe(
      true,
    );
    expect(v1FeedQueryParamSchema.safeParse({ limit: "501" }).success).toBe(
      false,
    );
    expect(publicFeedQueryParamSchema.safeParse({ limit: "100" }).success).toBe(
      true,
    );
    expect(publicFeedQueryParamSchema.safeParse({ limit: "101" }).success).toBe(
      false,
    );
  });

  test("maps snake_case feed params to FeedQuery", () => {
    const params = v1FeedQueryParamSchema.parse({
      tier: "p1",
      view: "today",
      hot_window_hours: "48",
      source_id: "dwarkesh-yt",
      source_group: "podcast",
      source_kind: "rss",
      date: "2026-06-12",
      curated_only: "1",
      include_source_tags: "vendor, deep-report, ",
      exclude_source_tags: "paper,,deprecated",
      limit: "25",
      offset: "10",
      locale: "zh",
    });

    expect(feedQueryFromParams(params)).toEqual({
      tier: "p1",
      locale: "zh",
      limit: 25,
      offset: 10,
      sourceId: "dwarkesh-yt",
      sourceGroup: "podcast",
      sourceKind: "rss",
      date: "2026-06-12",
      dateFrom: undefined,
      dateTo: undefined,
      includeSourceGroup: true,
      view: "today",
      hotWindowHours: 48,
      curatedOnly: true,
      excludeSourceTags: ["paper", "deprecated"],
      includeSourceTags: ["vendor", "deep-report"],
    });
  });

  test("validates source group and kind against runtime tuples", () => {
    expect(
      v1FeedQueryParamSchema.safeParse({
        source_group: SOURCE_GROUPS[0],
        source_kind: SOURCE_KINDS[0],
      }).success,
    ).toBe(true);
    expect(
      publicFeedQueryParamSchema.safeParse({ source_group: "not-a-group" })
        .success,
    ).toBe(false);
    expect(
      publicFeedQueryParamSchema.safeParse({ source_kind: "not-a-kind" })
        .success,
    ).toBe(false);
  });
});

describe("search query param schemas", () => {
  test("share search defaults while preserving v1/public limit ceilings", () => {
    const defaults = v1SearchQueryParamSchema.parse({ q: "agent" });

    expect(defaults).toMatchObject({
      q: "agent",
      mode: "lexical",
      tier: "all",
      limit: 20,
      offset: 0,
      locale: "en",
    });
    expect(v1SearchQueryParamSchema.safeParse({ q: "a", limit: "100" }).success)
      .toBe(true);
    expect(v1SearchQueryParamSchema.safeParse({ q: "a", limit: "101" }).success)
      .toBe(false);
    expect(
      publicSearchQueryParamSchema.safeParse({ q: "a", limit: "50" }).success,
    ).toBe(true);
    expect(
      publicSearchQueryParamSchema.safeParse({ q: "a", limit: "51" }).success,
    ).toBe(false);
  });

  test("maps lexical search params to FeedQuery", () => {
    const params = publicSearchQueryParamSchema.parse({
      q: "agentic ide",
      tier: "featured",
      date_from: "2026-06-01T00:00:00.000Z",
      date_to: "2026-06-12T00:00:00.000Z",
      source_id: "openai-news",
      limit: "5",
    });

    expect(searchFeedQueryFromParams(params)).toMatchObject({
      tier: "featured",
      locale: "en",
      limit: 5,
      offset: 0,
      sourceId: "openai-news",
      dateFrom: "2026-06-01T00:00:00.000Z",
      dateTo: "2026-06-12T00:00:00.000Z",
      includeSourceGroup: true,
      searchText: "agentic ide",
    });
  });

  test("validates search source group and kind against runtime tuples", () => {
    expect(
      v1SearchQueryParamSchema.safeParse({
        q: "agent",
        source_group: SOURCE_GROUPS[0],
        source_kind: SOURCE_KINDS[0],
      }).success,
    ).toBe(true);
    expect(
      publicSearchQueryParamSchema.safeParse({
        q: "agent",
        source_group: "not-a-group",
      }).success,
    ).toBe(false);
    expect(
      publicSearchQueryParamSchema.safeParse({
        q: "agent",
        source_kind: "not-a-kind",
      }).success,
    ).toBe(false);
  });

  test("keeps comma-list parsing centralized", () => {
    expect(parseCommaList(" alpha, beta ,, gamma ")).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
    expect(parseCommaList(" , , ")).toBeUndefined();
    expect(parseCommaList(undefined)).toBeUndefined();
  });
});
