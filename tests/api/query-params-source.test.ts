import { describe, expect, test } from "bun:test";
import { readSource as read } from "@/tests/helpers/source";

describe("query param source wiring", () => {
  test("query routes use the shared search-param parser", () => {
    const savedRoute = read("app/api/v1/saved/route.ts");
    const savedRequests = read("lib/api/saved-requests.ts");
    expect(savedRoute).toContain("parseV1SavedQueryRequest");
    expect(savedRoute).not.toContain("@/lib/api/query-params");
    expect(savedRequests).toContain("@/lib/api/query-params");
    expect(savedRequests).toContain("parseV1SavedQueryRequest");

    const dailies = read("app/api/public/dailies/route.ts");
    const publicContentHttp = read("lib/public-content/http.ts");
    expect(dailies).toContain("dailyIndexSnapshotRequestResult");
    expect(dailies).not.toContain("@/lib/api/query-params");
    expect(publicContentHttp).toContain("@/lib/api/query-params");
    expect(publicContentHttp).toContain("queryParamsRecord(req)");

    const publicFeed = read("app/api/public/feed/route.ts");
    const feedQueryParams = read("lib/api/feed-query-params.ts");
    expect(publicFeed).toContain("publicFeedSnapshotRequestResult");
    expect(publicFeed).not.toContain("@/lib/api/query-params");
    expect(publicContentHttp).toContain("parsePublicFeedQueryRequest");
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
      publicContentHttp,
      feedQueryParams,
      usageSummary,
    ]) {
      expect(source).not.toContain("Object.fromEntries(url.searchParams.entries())");
      expect(source).not.toContain("Object.fromEntries(req.searchParams.entries())");
    }
  });

  test("public invalid-query messages use the shared formatter", () => {
    const publicHelpers = read("lib/api/public-helpers.ts");
    const publicContentHttp = read("lib/public-content/http.ts");

    expect(publicHelpers).toContain("publicInvalidQuery");
    expect(publicHelpers).toContain("invalidQueryError(issues)");
    expect(publicContentHttp).toContain("invalidQueryError(parsed.error.issues)");
    expect(publicContentHttp).not.toContain("parsed.error.issues.map");
  });
});
