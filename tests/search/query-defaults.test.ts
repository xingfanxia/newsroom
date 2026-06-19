import { describe, expect, test } from "bun:test";
import { readSource, sectionBetween } from "@/tests/helpers/source";

describe("search query defaults source contracts", () => {
  test("REST/MCP search parsing and execution share search default constants", () => {
    const defaults = readSource("lib/search/query-defaults.ts");
    const queryParams = readSource("lib/api/feed-query-params.ts");
    const searchResults = readSource("lib/api/search-results.ts");
    const semanticSearch = readSource("lib/items/semantic-search.ts");

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
    expect(semanticSearch).toContain("DEFAULT_API_SEARCH_LOCALE");
    expect(semanticSearch).toContain("DEFAULT_SEARCH_LIMIT");
    expect(semanticSearch).toContain("SEARCH_LIMIT_MIN");
    expect(semanticSearch).toContain("MCP_SEARCH_LIMIT_MAX");
    expect(queryParams).not.toContain('.default("lexical")');
    expect(queryParams).not.toContain('.default("all")');
    expect(queryParams).not.toContain(".default(20)");
    expect(queryParams).not.toContain('args.mode ?? "lexical"');
    expect(queryParams).not.toContain('tier: "all"');
    expect(queryParams).not.toContain('args.locale ?? "en"');
    expect(semanticSearch).not.toContain('opts.locale ?? "en"');
    expect(semanticSearch).not.toContain("opts.limit ?? 20");
    expect(semanticSearch).not.toContain("Math.max(opts.limit ?? 20, 1)");
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

  test("search query limit bounds have one source of truth", () => {
    const defaults = readSource("lib/search/query-defaults.ts");
    const queryParams = readSource("lib/api/feed-query-params.ts");
    const openApiSearch = sectionBetween(
      readSource("app/openapi.yaml/route.ts"),
      "  /api/public/search:",
      "  /api/public/sources:",
    );

    for (const name of [
      "SEARCH_LIMIT_MIN",
      "V1_SEARCH_LIMIT_MAX",
      "PUBLIC_SEARCH_LIMIT_MAX",
      "MCP_SEARCH_LIMIT_MAX",
    ] as const) {
      expect(defaults).toContain(`export const ${name}`);
      expect(queryParams).toContain(name);
    }

    for (const name of ["PUBLIC_SEARCH_LIMIT_MAX", "SEARCH_LIMIT_MIN"] as const) {
      expect(openApiSearch).toContain(name);
    }

    expect(queryParams).not.toContain("maxLimit: 50");
    expect(queryParams).not.toContain("limit: z.number().int().min(1).max(100)");
    expect(openApiSearch).not.toContain("maximum: 50");
    expect(openApiSearch).not.toContain("minimum: 1");
  });
});
