import { describe, expect, test } from "bun:test";
import { readSource } from "@/tests/helpers/source";

describe("feed query defaults source contracts", () => {
  test("API query parsing, execution, and item lookup share feed default constants", () => {
    const defaults = readSource("lib/feed/query-defaults.ts");
    const queryParams = readSource("lib/api/feed-query-params.ts");
    const feedResults = readSource("lib/api/feed-results.ts");
    const itemLive = readSource("lib/items/live.ts");

    const allFeedDefaults = [
      "DEFAULT_FEED_TIER",
      "DEFAULT_FEED_VIEW",
      "DEFAULT_FEED_LIMIT",
      "DEFAULT_FEED_OFFSET",
      "DEFAULT_FEED_HOT_WINDOW_HOURS",
    ] as const;

    for (const name of allFeedDefaults) {
      expect(defaults).toContain(`export const ${name}`);
      expect(queryParams).toContain(name);
      expect(itemLive).toContain(name);
    }

    for (const name of [
      "DEFAULT_FEED_VIEW",
      "DEFAULT_FEED_LIMIT",
      "DEFAULT_FEED_OFFSET",
    ] as const) {
      expect(feedResults).toContain(name);
    }

    expect(queryParams).toContain("DEFAULT_API_FEED_LOCALE");
    expect(queryParams).not.toContain('args.tier ?? "featured"');
    expect(queryParams).not.toContain('args.view ?? "archive"');
    expect(queryParams).not.toContain("args.limit ?? 40");
    expect(queryParams).not.toContain("args.offset ?? 0");
    expect(queryParams).not.toContain("args.hot_window_hours ?? 24");
    expect(queryParams).not.toContain('.default("featured")');
    expect(queryParams).not.toContain('.default("archive")');
    expect(queryParams).not.toContain(".default(40)");
    expect(queryParams).not.toContain(".default(24)");

    expect(feedResults).not.toContain("feedQuery.limit ?? 40");
    expect(feedResults).not.toContain("feedQuery.offset ?? 0");
    expect(feedResults).not.toContain('feedQuery.view ?? "archive"');

    expect(itemLive).not.toContain("q.limit ?? 40");
    expect(itemLive).not.toContain("q.offset ?? 0");
    expect(itemLive).not.toContain('q.tier ?? "featured"');
    expect(itemLive).not.toContain('q.view ?? "archive"');
    expect(itemLive).not.toContain("q.hotWindowHours ?? 24");
  });

  test("OpenAPI feed docs use the runtime hot-window default", () => {
    const openApiRoute = readSource("app/openapi.yaml/route.ts");

    expect(openApiRoute).toContain("DEFAULT_FEED_HOT_WINDOW_HOURS");
    expect(openApiRoute).not.toContain("default: 24");
    expect(openApiRoute).not.toContain("Default returns today's hot");
    expect(openApiRoute).toContain("Set \\`view=today\\`");
  });
});
