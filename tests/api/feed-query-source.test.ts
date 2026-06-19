import { describe, expect, test } from "bun:test";
import { readSource as read } from "@/tests/helpers/source";

const routePaths = [
  "app/api/v1/feed/route.ts",
  "app/api/public/feed/route.ts",
  "app/api/v1/search/route.ts",
  "app/api/public/search/route.ts",
] as const;

const feedQueryParams = read("lib/api/feed-query-params.ts");

describe("feed/search route query parsing source wiring", () => {
  test("feed/search routes use the shared query schema module", () => {
    for (const path of routePaths) {
      const source = read(path);

      expect(source).toContain("@/lib/api/feed-query-params");
      expect(source).not.toContain("const querySchema = z.object");
      expect(source).not.toContain("function parseTagList");
    }
  });

  test("routes delegate public vs bearer query parsing to request helpers", () => {
    const v1FeedRoute = read("app/api/v1/feed/route.ts");
    const v1SearchRoute = read("app/api/v1/search/route.ts");

    expect(v1FeedRoute).toContain(
      "parseV1FeedQueryRequest(req)",
    );
    expect(read("app/api/public/feed/route.ts")).toContain(
      "parsePublicFeedQueryRequest(req)",
    );
    expect(v1SearchRoute).toContain(
      "parseV1SearchQueryRequest(req)",
    );
    expect(read("app/api/public/search/route.ts")).toContain(
      "parsePublicSearchQueryRequest(req)",
    );

    for (const path of routePaths) {
      const source = read(path);
      expect(source).not.toContain("@/lib/api/query-params");
      expect(source).not.toContain("parseQueryParams(");
      expect(source).not.toContain("new URL(req.url)");
      expect(source).not.toContain("publicFeedQueryParamSchema");
      expect(source).not.toContain("publicSearchQueryParamSchema");
      expect(source).not.toContain("v1FeedQueryParamSchema");
      expect(source).not.toContain("v1SearchQueryParamSchema");
    }

    expect(feedQueryParams).toContain("@/lib/api/query-params");
    expect(feedQueryParams).toContain("parseFeedRequestQuery");
    expect(feedQueryParams).toContain("publicFeedQueryParamSchema");
    expect(feedQueryParams).toContain("v1SearchQueryParamSchema");
  });

  test("v1 route comments do not hand-write query defaults or bounds", () => {
    const v1FeedRoute = read("app/api/v1/feed/route.ts");
    const v1SearchRoute = read("app/api/v1/search/route.ts");

    expect(v1FeedRoute).toContain("lib/feed/query-defaults.ts");
    expect(v1SearchRoute).toContain("lib/search/query-defaults.ts");

    for (const staleCopy of [
      "featured (default)",
      "archive (default",
      "1..168, default 24",
      "1..500, default 40",
      "zh | en (default en)",
      "lexical (default)",
      "default all",
      "1..100, default 20",
    ]) {
      expect(v1FeedRoute).not.toContain(staleCopy);
      expect(v1SearchRoute).not.toContain(staleCopy);
    }
  });

  test("search routes share execution so lexical totals and semantic options cannot drift", () => {
    for (const path of [
      "app/api/v1/search/route.ts",
      "app/api/public/search/route.ts",
    ] as const) {
      const source = read(path);

      expect(source).toContain("@/lib/api/search-results");
      expect(source).not.toContain("@/lib/items/semantic-search");
      expect(source).not.toContain("getFeaturedStories");
      expect(source).not.toContain("countFeaturedStories");
      expect(source).not.toContain("total: stories.length");
    }
  });

  test("search routes delegate payload serialization to the shared search helper", () => {
    expect(read("app/api/v1/search/route.ts")).toContain(
      "toAgentSearchPayload(result, p.locale)",
    );
    expect(read("app/api/public/search/route.ts")).toContain(
      "toPublicSearchPayload(result, p.locale)",
    );

    for (const path of [
      "app/api/v1/search/route.ts",
      "app/api/public/search/route.ts",
    ] as const) {
      const source = read(path);
      expect(source).not.toContain("@/lib/api/v1-items");
      expect(source).not.toContain("@/lib/api/public-items");
      expect(source).not.toContain("toAgentApiItem");
      expect(source).not.toContain("toPublicApiItem");
      expect(source).not.toContain("distance: s.distance");
      expect(source).not.toContain("embedding_dims:");
      expect(source).not.toContain("latency_ms:");
    }
  });

  test("feed routes share execution so totals and defaults cannot drift", () => {
    for (const path of [
      "app/api/v1/feed/route.ts",
      "app/api/public/feed/route.ts",
    ] as const) {
      const source = read(path);

      expect(source).toContain("@/lib/api/feed-results");
      expect(source).not.toContain("getFeaturedStories");
      expect(source).not.toContain("countFeaturedStories");
    }
  });

  test("feed routes delegate payload serialization to the shared feed helper", () => {
    expect(read("app/api/v1/feed/route.ts")).toContain(
      "toAgentFeedPayload(result, q.locale)",
    );
    expect(read("app/api/public/feed/route.ts")).toContain(
      "toPublicFeedPayload(result, q.locale)",
    );

    for (const path of [
      "app/api/v1/feed/route.ts",
      "app/api/public/feed/route.ts",
    ] as const) {
      const source = read(path);
      expect(source).not.toContain("@/lib/api/v1-items");
      expect(source).not.toContain("@/lib/api/public-items");
      expect(source).not.toContain("toAgentApiItem");
      expect(source).not.toContain("toPublicApiItem");
      expect(source).not.toContain("result.items.map");
    }
  });
});
