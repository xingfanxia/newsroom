import { describe, expect, test } from "bun:test";
import { readSource } from "@/tests/helpers/source";

describe("search query defaults source contracts", () => {
  test("REST/MCP search parsing and execution share search default constants", () => {
    const defaults = readSource("lib/search/query-defaults.ts");
    const queryParams = readSource("lib/api/feed-query-params.ts");
    const searchResults = readSource("lib/api/search-results.ts");

    for (const name of [
      "DEFAULT_SEARCH_MODE",
      "DEFAULT_SEARCH_TIER",
      "DEFAULT_SEARCH_LIMIT",
      "DEFAULT_SEARCH_OFFSET",
      "DEFAULT_SEARCH_SEMANTIC_INCLUDE_EXCLUDED",
      "DEFAULT_API_SEARCH_LOCALE",
    ] as const) {
      expect(defaults).toContain(`export const ${name}`);
      expect(queryParams).toContain(name);
    }

    expect(searchResults).toContain("DEFAULT_SEARCH_OFFSET");
    expect(queryParams).not.toContain('.default("lexical")');
    expect(queryParams).not.toContain('.default("all")');
    expect(queryParams).not.toContain(".default(20)");
    expect(queryParams).not.toContain('args.mode ?? "lexical"');
    expect(queryParams).not.toContain('tier: "all"');
    expect(queryParams).not.toContain('args.locale ?? "en"');
    expect(queryParams).not.toContain("args.limit ?? 20");
    expect(queryParams).not.toContain("offset: 0");
    expect(queryParams).not.toContain("semanticIncludeExcluded: false");

    expect(searchResults).not.toContain("offset: 0,\n      embeddingDims");
  });

  test("OpenAPI search docs use runtime search defaults", () => {
    const openApiRoute = readSource("app/openapi.yaml/route.ts");

    for (const name of [
      "DEFAULT_SEARCH_MODE",
      "DEFAULT_SEARCH_TIER",
      "DEFAULT_SEARCH_LIMIT",
      "DEFAULT_SEARCH_OFFSET",
      "DEFAULT_API_SEARCH_LOCALE",
    ] as const) {
      expect(openApiRoute).toContain(name);
    }
    expect(openApiRoute).not.toContain("default: lexical");
    expect(openApiRoute).not.toContain("default: all");
    expect(openApiRoute).not.toContain("default: 20");
  });
});
