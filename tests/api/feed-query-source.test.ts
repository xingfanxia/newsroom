import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const routePaths = [
  "app/api/v1/feed/route.ts",
  "app/api/public/feed/route.ts",
  "app/api/v1/search/route.ts",
  "app/api/public/search/route.ts",
] as const;

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

describe("feed/search route query parsing source wiring", () => {
  test("feed/search routes use the shared query schema module", () => {
    for (const path of routePaths) {
      const source = read(path);

      expect(source).toContain("@/lib/api/feed-query-params");
      expect(source).not.toContain("const querySchema = z.object");
      expect(source).not.toContain("function parseTagList");
    }
  });

  test("routes keep their intended public vs bearer limit contracts", () => {
    expect(read("app/api/v1/feed/route.ts")).toContain(
      "parseQueryParams(req, v1FeedQueryParamSchema)",
    );
    expect(read("app/api/public/feed/route.ts")).toContain(
      "parseQueryParams(url, publicFeedQueryParamSchema)",
    );
    expect(read("app/api/v1/search/route.ts")).toContain(
      "parseQueryParams(req, v1SearchQueryParamSchema)",
    );
    expect(read("app/api/public/search/route.ts")).toContain(
      "parseQueryParams(url, publicSearchQueryParamSchema)",
    );
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
});
