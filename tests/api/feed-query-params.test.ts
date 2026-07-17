import { describe, expect, test } from "bun:test";
import {
  feedQueryFromParams,
  feedQueryFromMcpToolArgs,
  mcpFeedToolInputSchema,
  mcpSearchToolInputSchema,
  parseCommaList,
  parsePublicFeedQueryRequest,
  parsePublicSearchQueryRequest,
  parseV1FeedQueryRequest,
  parseV1SearchQueryRequest,
  publicFeedQueryParamSchema,
  publicSearchQueryParamSchema,
  searchFeedQueryFromParams,
  searchQueryFromMcpToolArgs,
  v1FeedQueryParamSchema,
  v1SearchQueryParamSchema,
} from "@/lib/api/feed-query-params";
import { SEARCH_MODES, SOURCE_GROUPS, SOURCE_KINDS } from "@/lib/types";

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
    expect(v1FeedQueryParamSchema.safeParse({ limit: "200" }).success).toBe(
      true,
    );
    expect(v1FeedQueryParamSchema.safeParse({ limit: "201" }).success).toBe(
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

  test("rejects pathological archive offsets before reading storage", () => {
    expect(v1FeedQueryParamSchema.safeParse({ offset: "100000" }).success).toBe(
      true,
    );
    expect(v1FeedQueryParamSchema.safeParse({ offset: "100001" }).success).toBe(
      false,
    );
  });
});

describe("MCP feed query input helpers", () => {
  test("validate MCP feed limits and map defaults to FeedQuery", () => {
    expect(mcpFeedToolInputSchema.safeParse({ limit: 100 }).success).toBe(true);
    expect(mcpFeedToolInputSchema.safeParse({ limit: 101 }).success).toBe(false);

    const query = feedQueryFromMcpToolArgs({});

    expect(query).toMatchObject({
      tier: "featured",
      locale: "en",
      limit: 40,
      offset: 0,
      includeSourceGroup: true,
      view: "archive",
      hotWindowHours: 24,
    });
    expect(query.curatedOnly).toBeUndefined();
    expect(query.excludeSourceTags).toBeUndefined();
    expect(query.includeSourceTags).toBeUndefined();
  });

  test("maps MCP feed args without re-parsing array tag filters", () => {
    const args = mcpFeedToolInputSchema.parse({
      tier: "p1",
      view: "today",
      hot_window_hours: 6,
      source_id: "ai-chatgroup-daily",
      source_group: "newsletter",
      source_kind: "rss",
      date: "2026-06-12",
      date_from: "2026-06-11T00:00:00.000Z",
      date_to: "2026-06-12T00:00:00.000Z",
      curated_only: true,
      include_source_tags: ["operator", "community"],
      exclude_source_tags: ["paper"],
      limit: 12,
      offset: 8,
      locale: "zh",
    });

    expect(feedQueryFromMcpToolArgs(args)).toEqual({
      tier: "p1",
      locale: "zh",
      limit: 12,
      offset: 8,
      sourceId: "ai-chatgroup-daily",
      sourceGroup: "newsletter",
      sourceKind: "rss",
      date: "2026-06-12",
      dateFrom: "2026-06-11T00:00:00.000Z",
      dateTo: "2026-06-12T00:00:00.000Z",
      includeSourceGroup: true,
      view: "today",
      hotWindowHours: 6,
      curatedOnly: true,
      excludeSourceTags: ["paper"],
      includeSourceTags: ["operator", "community"],
    });
  });

  test("bounds MCP filter arrays and offsets", () => {
    expect(
      mcpFeedToolInputSchema.safeParse({
        include_source_tags: Array.from({ length: 33 }, () => "tag"),
      }).success,
    ).toBe(false);
    expect(mcpFeedToolInputSchema.safeParse({ offset: 100_001 }).success).toBe(
      false,
    );
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

  test("validates search mode against the runtime tuple", () => {
    for (const mode of SEARCH_MODES) {
      expect(
        publicSearchQueryParamSchema.safeParse({ q: "agent", mode }).success,
      ).toBe(true);
    }
    expect(
      v1SearchQueryParamSchema.safeParse({ q: "agent", mode: "hybrid" })
        .success,
    ).toBe(false);
  });

  test("bounds lexical and semantic query text before execution", () => {
    expect(publicSearchQueryParamSchema.safeParse({ q: "x".repeat(256) }).success)
      .toBe(true);
    expect(publicSearchQueryParamSchema.safeParse({ q: "x".repeat(257) }).success)
      .toBe(false);
    expect(mcpSearchToolInputSchema.safeParse({ q: "x".repeat(257) }).success)
      .toBe(false);
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

describe("MCP search query input helpers", () => {
  test("validate MCP search limits and map defaults to search execution params", () => {
    expect(mcpSearchToolInputSchema.safeParse({ q: "agent", limit: 100 }).success)
      .toBe(true);
    expect(mcpSearchToolInputSchema.safeParse({ q: "agent", limit: 101 }).success)
      .toBe(false);

    expect(searchQueryFromMcpToolArgs({ q: "agent" })).toMatchObject({
      q: "agent",
      mode: "lexical",
      tier: "all",
      locale: "en",
      limit: 20,
      offset: 0,
      semanticIncludeExcluded: false,
    });
  });

  test("maps MCP semantic search args to the REST search execution shape", () => {
    const args = mcpSearchToolInputSchema.parse({
      q: "autonomous coding agent",
      mode: "semantic",
      source_id: "openai-news",
      source_group: "vendor-official",
      source_kind: "rss",
      date_from: "2026-06-01T00:00:00.000Z",
      date_to: "2026-06-12T00:00:00.000Z",
      limit: 7,
      locale: "zh",
    });

    expect(searchQueryFromMcpToolArgs(args)).toEqual({
      q: "autonomous coding agent",
      mode: "semantic",
      tier: "all",
      locale: "zh",
      limit: 7,
      offset: 0,
      source_id: "openai-news",
      source_group: "vendor-official",
      source_kind: "rss",
      date_from: "2026-06-01T00:00:00.000Z",
      date_to: "2026-06-12T00:00:00.000Z",
      semanticIncludeExcluded: false,
    });
  });
});

describe("feed/search request query helpers", () => {
  test("parse route requests and preserve the raw query string for public etags", () => {
    const publicFeed = parsePublicFeedQueryRequest(
      new Request("https://example.test/api/public/feed?limit=5&locale=zh"),
    );
    expect(publicFeed).toMatchObject({
      ok: true,
      search: "?limit=5&locale=zh",
      data: { limit: 5, locale: "zh" },
    });

    const v1Search = parseV1SearchQueryRequest(
      new Request("https://example.test/api/v1/search?q=agent&limit=100"),
    );
    expect(v1Search).toMatchObject({
      ok: true,
      search: "?q=agent&limit=100",
      data: { q: "agent", limit: 100 },
    });
  });

  test("keep public and bearer ceilings in the shared request helpers", () => {
    const publicSearch = parsePublicSearchQueryRequest(
      new Request("https://example.test/api/public/search?q=agent&limit=51"),
    );
    expect(publicSearch.ok).toBe(false);
    if (!publicSearch.ok) expect(publicSearch.issues.length).toBeGreaterThan(0);

    const v1Feed = parseV1FeedQueryRequest(
      new Request("https://example.test/api/v1/feed?limit=200"),
    );
    expect(v1Feed).toMatchObject({
      ok: true,
      data: { limit: 200 },
    });
  });
});
