import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();

const queryRoutePaths = [
  "app/api/public/dailies/route.ts",
  "app/api/public/feed/route.ts",
  "app/api/public/search/route.ts",
  "app/api/v1/feed/route.ts",
  "app/api/v1/search/route.ts",
  "app/api/v1/saved/route.ts",
  "app/api/v1/usage/summary/route.ts",
] as const;

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

describe("query param source wiring", () => {
  test("query routes use the shared search-param parser", () => {
    for (const path of queryRoutePaths) {
      const source = read(path);
      expect(source).toContain("@/lib/api/query-params");
      expect(source).not.toContain("Object.fromEntries(url.searchParams.entries())");
      expect(source).not.toContain("Object.fromEntries(req.searchParams.entries())");
    }
  });

  test("public invalid-query messages use the shared formatter", () => {
    const publicHelpers = read("lib/api/public-helpers.ts");
    const dailyColumns = read("lib/api/daily-columns.ts");

    expect(publicHelpers).toContain("publicInvalidQuery");
    expect(publicHelpers).toContain("invalidQueryError(issues)");
    expect(dailyColumns).toContain("invalidQueryError(parsed.error.issues)");
    expect(dailyColumns).not.toContain("parsed.error.issues.map");
  });
});
