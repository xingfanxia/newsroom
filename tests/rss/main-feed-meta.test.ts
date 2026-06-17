import { describe, expect, test } from "bun:test";
import {
  MAIN_RSS_FEEDS,
  coerceMainRssLocale,
  mainRssFeedMeta,
} from "@/lib/rss/main-feed-meta";

describe("main RSS feed metadata", () => {
  test("keeps the public main-feed paths in one ordered contract", () => {
    expect(MAIN_RSS_FEEDS.map((feed) => feed.locale)).toEqual(["zh", "en"]);
    expect(MAIN_RSS_FEEDS.map((feed) => feed.apiPath)).toEqual([
      "/api/feed/zh/rss.xml",
      "/api/feed/en/rss.xml",
    ]);
  });

  test("coerces route locales with the existing zh fallback", () => {
    expect(coerceMainRssLocale("en")).toBe("en");
    expect(coerceMainRssLocale("zh")).toBe("zh");
    expect(coerceMainRssLocale("fr")).toBe("zh");
  });

  test("maps locale metadata for RSS channels and discovery surfaces", () => {
    expect(mainRssFeedMeta("zh")).toMatchObject({
      route: "/zh",
      language: "zh-CN",
      alternateTitle: "AX 的 AI 雷达 (中文)",
    });
    expect(mainRssFeedMeta("en")).toMatchObject({
      route: "/en",
      language: "en-US",
      alternateTitle: "AX's AI RADAR (English)",
    });
  });
});
