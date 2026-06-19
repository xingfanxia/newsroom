import { describe, expect, test } from "bun:test";
import {
  MAIN_RSS_FEEDS,
  coerceMainRssLocale,
  mainRssFeedMeta,
} from "@/lib/rss/main-feed-meta";
import { APP_LOCALES, appLocaleLanguageTag } from "@/lib/types";

describe("main RSS feed metadata", () => {
  test("keeps the public main-feed paths in one ordered contract", () => {
    expect(MAIN_RSS_FEEDS.map((feed) => feed.locale)).toEqual([
      ...APP_LOCALES,
    ]);
    expect(MAIN_RSS_FEEDS.map((feed) => feed.apiPath)).toEqual([
      "/api/feed/zh/rss.xml",
      "/api/feed/en/rss.xml",
    ]);
  });

  test("covers every app locale exactly once", () => {
    const locales = MAIN_RSS_FEEDS.map((feed) => feed.locale);
    expect(new Set(locales).size).toBe(APP_LOCALES.length);
    for (const locale of APP_LOCALES) {
      expect(mainRssFeedMeta(locale).locale).toBe(locale);
      expect(coerceMainRssLocale(locale)).toBe(locale);
    }
  });

  test("coerces route locales with the existing zh fallback", () => {
    expect(coerceMainRssLocale("en")).toBe("en");
    expect(coerceMainRssLocale("zh")).toBe("zh");
    expect(coerceMainRssLocale("fr")).toBe("zh");
  });

  test("maps locale metadata for RSS channels and discovery surfaces", () => {
    expect(mainRssFeedMeta("zh")).toMatchObject({
      route: "/zh",
      language: appLocaleLanguageTag("zh"),
      alternateTitle: "AX 的 AI 雷达 (中文)",
    });
    expect(mainRssFeedMeta("en")).toMatchObject({
      route: "/en",
      language: appLocaleLanguageTag("en"),
      alternateTitle: "AX's AI RADAR (English)",
    });
  });
});
