import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

describe("query param source wiring", () => {
  test("query routes use the shared search-param parser", () => {
    const savedRoute = read("app/api/v1/saved/route.ts");
    const savedRequests = read("lib/api/saved-requests.ts");
    expect(savedRoute).toContain("parseV1SavedQueryRequest");
    expect(savedRoute).not.toContain("@/lib/api/query-params");
    expect(savedRequests).toContain("@/lib/api/query-params");
    expect(savedRequests).toContain("parseV1SavedQueryRequest");

    const dailies = read("app/api/public/dailies/route.ts");
    const dailyColumns = read("lib/api/daily-columns.ts");
    expect(dailies).toContain("getPublicDailyColumnIndexRequestPayload");
    expect(dailies).not.toContain("@/lib/api/query-params");
    expect(dailyColumns).toContain("@/lib/api/query-params");
    expect(dailyColumns).toContain("queryParamsRecord(req)");

    const publicFeed = read("app/api/public/feed/route.ts");
    const feedQueryParams = read("lib/api/feed-query-params.ts");
    expect(publicFeed).toContain("parsePublicFeedQueryRequest");
    expect(publicFeed).not.toContain("@/lib/api/query-params");
    expect(feedQueryParams).toContain("@/lib/api/query-params");
    expect(feedQueryParams).toContain("parseFeedRequestQuery");

    const usageRoute = read("app/api/v1/usage/summary/route.ts");
    const usageSummary = read("lib/api/usage-summary.ts");
    expect(usageRoute).toContain("parseUsageSummaryQueryRequest");
    expect(usageRoute).not.toContain("@/lib/api/query-params");
    expect(usageSummary).toContain("@/lib/api/query-params");
    expect(usageSummary).toContain("parseUsageSummaryQueryRequest");

    for (const source of [
      savedRoute,
      savedRequests,
      dailyColumns,
      feedQueryParams,
      usageSummary,
    ]) {
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
