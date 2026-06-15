import { describe, expect, test } from "bun:test";
import { readSource, sectionBetween } from "@/tests/helpers/source";

const routePaths = [
  "app/api/public/daily/route.ts",
  "app/api/public/daily/[date]/route.ts",
  "app/api/public/dailies/route.ts",
] as const;
const dailyUiPaths = [
  "app/[locale]/daily/page.tsx",
  "app/[locale]/daily/[date]/page.tsx",
] as const;
const legacyRssFeeds = readSource("lib/rss/legacy-feeds.ts");

const mcpRoute = readSource("app/api/mcp/route.ts");
const mcpDailyResources = sectionBetween(
  mcpRoute,
  "// ── Daily column resources",
  "  return server;",
);

describe("daily-column API source wiring", () => {
  test("public daily routes delegate query parsing and serialization", () => {
    for (const path of routePaths) {
      const source = readSource(path);

      expect(source).toContain("@/lib/api/daily-columns");
      expect(source).not.toContain(".select({");
      expect(source).not.toContain("from(newsletters)");
      expect(source).not.toContain("function dateKey");
      expect(source).not.toContain("dailyColumnLocaleSchema");
      expect(source).not.toContain("dailyColumnDateSchema");
      expect(source).not.toContain("toPublicDailyColumn(");
      expect(source).not.toContain("toPublicDailyColumnIndex(");
      expect(source).not.toContain("publicDailyColumnEtagSignal(");
      expect(source).not.toContain("publicDailyColumnIndexEtagSignal(");
      expect(source).not.toContain("new URL(req.url)");
      expect(source).not.toContain("queryParamsRecord(req)");
      expect(source).not.toContain('searchParams.get("locale")');
    }
    expect(readSource("app/api/public/daily/route.ts")).toContain(
      "getLatestPublicDailyColumnRequestPayload",
    );
    expect(readSource("app/api/public/daily/[date]/route.ts")).toContain(
      "getPublicDailyColumnByDateRequestPayload",
    );
    expect(readSource("app/api/public/dailies/route.ts")).toContain(
      "getPublicDailyColumnIndexRequestPayload",
    );
  });

  test("site daily pages and RSS helpers reuse the same daily-column query helpers", () => {
    for (const path of dailyUiPaths) {
      const source = readSource(path);

      expect(source).toContain("@/lib/api/daily-columns");
      expect(source).not.toContain(".select({");
      expect(source).not.toContain("from(newsletters)");
      expect(source).not.toContain("newsletters.columnTitle");
    }
    expect(readSource("app/[locale]/daily/page.tsx")).toContain(
      "listDailyColumnRows",
    );
    expect(readSource("app/[locale]/daily/page.tsx")).toContain(
      "@/lib/time/relative",
    );
    expect(readSource("app/[locale]/daily/page.tsx")).not.toContain(
      "function relativeAgo",
    );
    expect(readSource("app/[locale]/daily/[date]/page.tsx")).toContain(
      "getDailyColumnRowByDate",
    );
    expect(legacyRssFeeds).toContain("@/lib/api/daily-columns");
    expect(legacyRssFeeds).toContain("listDailyColumnRows");
    expect(legacyRssFeeds).not.toContain("from(newsletters)");
    expect(readSource("app/api/rss/[slug]/route.ts")).toContain(
      "@/lib/rss/legacy-feeds",
    );
  });

  test("MCP daily resources use the same daily-column module", () => {
    expect(mcpRoute).toContain("@/lib/api/daily-columns");
    expect(mcpDailyResources).toContain("getLatestDailyColumnMarkdown");
    expect(mcpDailyResources).toContain("getDailyColumnMarkdownByDate");
    expect(mcpDailyResources).not.toContain("dailyColumnDateSchema");
    expect(mcpDailyResources).not.toContain("getLatestDailyColumnRow");
    expect(mcpDailyResources).not.toContain("getDailyColumnRowByDate");
    expect(mcpDailyResources).not.toContain("renderDailyColumnMarkdown");
    expect(mcpDailyResources).not.toContain(".select({");
    expect(mcpDailyResources).not.toContain("from(newsletters)");
    expect(mcpDailyResources).not.toContain("function dateKey");
  });
});
