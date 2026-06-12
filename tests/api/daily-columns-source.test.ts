import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

function sectionBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

const routePaths = [
  "app/api/public/daily/route.ts",
  "app/api/public/daily/[date]/route.ts",
  "app/api/public/dailies/route.ts",
] as const;
const dailyUiPaths = [
  "app/[locale]/daily/page.tsx",
  "app/[locale]/daily/[date]/page.tsx",
  "app/api/rss/[slug]/route.ts",
] as const;

const mcpRoute = read("app/api/mcp/route.ts");
const mcpDailyResources = sectionBetween(
  mcpRoute,
  "// ── Daily column resources",
  "  return server;",
);

describe("daily-column API source wiring", () => {
  test("public daily routes delegate query parsing and serialization", () => {
    for (const path of routePaths) {
      const source = read(path);

      expect(source).toContain("@/lib/api/daily-columns");
      expect(source).not.toContain(".select({");
      expect(source).not.toContain("from(newsletters)");
      expect(source).not.toContain("function dateKey");
    }
    expect(read("app/api/public/daily/route.ts")).toContain(
      "getLatestDailyColumnRow",
    );
    expect(read("app/api/public/daily/[date]/route.ts")).toContain(
      "getDailyColumnRowByDate",
    );
    expect(read("app/api/public/dailies/route.ts")).toContain(
      "listDailyColumnIndexRows",
    );
  });

  test("site daily pages and RSS reuse the same daily-column query helpers", () => {
    for (const path of dailyUiPaths) {
      const source = read(path);

      expect(source).toContain("@/lib/api/daily-columns");
      expect(source).not.toContain(".select({");
      expect(source).not.toContain("from(newsletters)");
      expect(source).not.toContain("newsletters.columnTitle");
    }
    expect(read("app/[locale]/daily/page.tsx")).toContain(
      "listDailyColumnRows",
    );
    expect(read("app/[locale]/daily/[date]/page.tsx")).toContain(
      "getDailyColumnRowByDate",
    );
    expect(read("app/api/rss/[slug]/route.ts")).toContain(
      "listDailyColumnRows",
    );
  });

  test("MCP daily resources use the same daily-column module", () => {
    expect(mcpRoute).toContain("@/lib/api/daily-columns");
    expect(mcpDailyResources).toContain("getLatestDailyColumnRow");
    expect(mcpDailyResources).toContain("getDailyColumnRowByDate");
    expect(mcpDailyResources).toContain("renderDailyColumnMarkdown");
    expect(mcpDailyResources).not.toContain(".select({");
    expect(mcpDailyResources).not.toContain("from(newsletters)");
    expect(mcpDailyResources).not.toContain("function dateKey");
  });
});
