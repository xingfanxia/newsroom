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
const dailyColumnApi = readSource("lib/api/daily-columns.ts");
const dailyColumnQueryDefaults = readSource("lib/daily-column/query-defaults.ts");
const dailyColumnRoutes = readSource("lib/daily-column/routes.ts");
const dailyLandingPage = readSource("app/[locale]/daily/page.tsx");
const dailyRenderer = readSource("app/[locale]/daily/_renderer.tsx");
const legacyRssFeeds = readSource("lib/rss/legacy-feeds.ts");
const legacyRssFeedMeta = readSource("lib/rss/legacy-feed-meta.ts");
const publicDailiesRoute = readSource("app/api/public/dailies/route.ts");
const openApiRoute = readSource("app/openapi.yaml/route.ts");
const skillRoute = readSource("app/skill.md/route.ts");

const mcpRoute = readSource("app/api/mcp/route.ts");
const mcpDailyResources = sectionBetween(
  mcpRoute,
  "// ── Daily column resources",
  "  return server;",
);

describe("daily-column API source wiring", () => {
  test("daily-column public query defaults have one source of truth", () => {
    expect(dailyColumnQueryDefaults).toContain("DAILY_COLUMN_INDEX_TAKE_MIN");
    expect(dailyColumnQueryDefaults).toContain("DAILY_COLUMN_INDEX_TAKE_MAX");
    expect(dailyColumnQueryDefaults).toContain("DEFAULT_DAILY_COLUMN_INDEX_TAKE");
    expect(dailyColumnQueryDefaults).toContain("DEFAULT_DAILY_COLUMN_QUERY_LOCALE");
    expect(dailyColumnQueryDefaults).toContain("DAILY_COLUMN_LOCALE");

    expect(dailyColumnApi).toContain("@/lib/daily-column/query-defaults");
    expect(dailyColumnApi).toContain(".min(DAILY_COLUMN_INDEX_TAKE_MIN)");
    expect(dailyColumnApi).toContain(".max(DAILY_COLUMN_INDEX_TAKE_MAX)");
    expect(dailyColumnApi).toContain(".default(DEFAULT_DAILY_COLUMN_INDEX_TAKE)");
    expect(dailyColumnApi).toContain("DEFAULT_DAILY_COLUMN_QUERY_LOCALE");
    expect(dailyColumnApi).not.toContain(".min(1).max(180).optional().default(30)");
    expect(dailyColumnApi).not.toContain('rawLocale ?? "zh"');

    expect(openApiRoute).toContain("@/lib/daily-column/query-defaults");
    expect(openApiRoute).toContain("DAILY_COLUMN_INDEX_TAKE_MIN");
    expect(openApiRoute).toContain("DAILY_COLUMN_INDEX_TAKE_MAX");
    expect(openApiRoute).toContain("DEFAULT_DAILY_COLUMN_INDEX_TAKE");
    expect(openApiRoute).toContain("DEFAULT_DAILY_COLUMN_QUERY_LOCALE");
    expect(openApiRoute).not.toContain("minimum: 1, maximum: 180, default: 30");
    expect(openApiRoute).not.toContain("default: zh }, description: \"Only zh is generated today\"");

    expect(skillRoute).toContain("@/lib/daily-column/query-defaults");
    expect(skillRoute).toContain("DEFAULT_DAILY_COLUMN_INDEX_TAKE");
    expect(skillRoute).toContain("DAILY_COLUMN_INDEX_TAKE_MAX");
    expect(skillRoute).not.toContain("/api/public/dailies?take=30");
    expect(skillRoute).not.toContain("take` (≤ 180, default 30)");

    expect(publicDailiesRoute).not.toContain("take: 1..180, default 30");
    expect(publicDailiesRoute).toContain("query bounds live in");
  });

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
      expect(source).toContain("publicRouteResult(");
      expect(source).not.toContain("if (!result.ok) return result");
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
    expect(dailyLandingPage).toContain("@/lib/time/relative");
    expect(dailyLandingPage).toContain("DAILY_COLUMN_LOCALE");
    expect(dailyLandingPage).toContain("DAILY_COLUMN_INDEX_ROUTE");
    expect(dailyLandingPage).toContain("dailyColumnIssueRoute");
    expect(dailyLandingPage).not.toContain(
      "function relativeAgo",
    );
    expect(dailyLandingPage).not.toContain("`/zh/daily");
    expect(readSource("app/[locale]/daily/[date]/page.tsx")).toContain(
      "getDailyColumnRowByDate",
    );
    expect(readSource("app/[locale]/daily/[date]/page.tsx")).toContain(
      "DAILY_COLUMN_LOCALE",
    );
    expect(dailyColumnApi).toContain(".default(DEFAULT_DAILY_COLUMN_QUERY_LOCALE)");
    expect(dailyColumnRoutes).toContain("DAILY_COLUMN_BASE_ROUTE");
    expect(dailyColumnRoutes).toContain("DAILY_COLUMN_INDEX_ROUTE");
    expect(dailyColumnRoutes).toContain("dailyColumnIssueRoute");
    expect(dailyColumnRoutes).toContain("dailyColumnItemRoute");
    expect(dailyColumnRoutes).not.toContain("@/db/");
    expect(dailyRenderer).toContain("DAILY_COLUMN_LOCALE");
    expect(dailyRenderer).toContain("appLocaleLanguageTag");
    expect(dailyRenderer).toContain("DAILY_COLUMN_INDEX_ROUTE");
    expect(dailyRenderer).toContain("dailyColumnItemRoute");
    expect(dailyRenderer).not.toContain('"zh-CN"');
    expect(dailyRenderer).not.toContain('href="/zh/daily"');
    expect(dailyRenderer).not.toContain("](/zh/items/");
    expect(legacyRssFeeds).toContain("@/lib/api/daily-columns");
    expect(legacyRssFeeds).toContain("listDailyColumnRows");
    expect(legacyRssFeeds).toContain("dailyColumnIssueRoute");
    expect(legacyRssFeeds).toContain("DAILY_COLUMN_LOCALE");
    expect(legacyRssFeeds).not.toContain("`/zh/daily");
    expect(legacyRssFeedMeta).toContain("DAILY_COLUMN_INDEX_ROUTE");
    expect(legacyRssFeedMeta).toContain("@/lib/daily-column/routes");
    expect(legacyRssFeedMeta).not.toContain("@/lib/api/daily-columns");
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
