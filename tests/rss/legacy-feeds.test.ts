import { describe, expect, test } from "bun:test";
import {
  dailyColumnRssItem,
  legacyLaneRssItem,
  parseLegacyRssSlug,
} from "@/lib/rss/legacy-feeds";
import {
  LEGACY_RSS_FEEDS,
  legacyRssFeedMeta,
} from "@/lib/rss/legacy-feed-meta";

describe("legacy RSS feed helpers", () => {
  test("parses supported slugs with or without the .xml suffix", () => {
    expect(parseLegacyRssSlug("daily")).toBe("daily");
    expect(parseLegacyRssSlug("daily.xml")).toBe("daily");
    expect(parseLegacyRssSlug("today.xml")).toBe("today");
    expect(parseLegacyRssSlug("curated.xml")).toBe("curated");
    expect(parseLegacyRssSlug("papers.xml")).toBeNull();
  });

  test("keeps public RSS metadata in one ordered contract", () => {
    expect(LEGACY_RSS_FEEDS.map((feed) => feed.slug)).toEqual([
      "today",
      "curated",
      "daily",
    ]);
    expect(LEGACY_RSS_FEEDS.map((feed) => feed.apiPath)).toEqual([
      "/api/rss/today.xml",
      "/api/rss/curated.xml",
      "/api/rss/daily.xml",
    ]);
    expect(legacyRssFeedMeta("today").recommended).toBe(true);
    expect(legacyRssFeedMeta("daily").route).toBe("/zh/daily");
  });

  test("maps daily-column rows to stable RSS items", () => {
    expect(
      dailyColumnRssItem({
        columnTitle: "今天 AI 圈在拼开源",
        columnThemeTag: "开源与禁令",
        columnSummaryMd: "1. summary",
        columnNarrativeMd: "long narrative",
        periodStart: new Date("2026-06-12T05:00:00.000Z"),
        publishedAt: new Date("2026-06-13T05:01:32.000Z"),
      }),
    ).toEqual({
      title: "AX 的 AI 日报 · 2026-06-12 · 今天 AI 圈在拼开源",
      link: "https://news.ax0x.ai/zh/daily/2026-06-12",
      description: "1. summary",
      pubDate: new Date("2026-06-13T05:01:32.000Z"),
      guid: "https://news.ax0x.ai/zh/daily/2026-06-12",
      category: "开源与禁令",
      contentEncoded: "1. summary\n\nlong narrative",
    });
  });

  test("maps lane rows with locale fallbacks and stable item links", () => {
    expect(
      legacyLaneRssItem({
        id: 38042,
        title_zh: null,
        title_en: "English title",
        title: "Raw title",
        summary_zh: null,
        summary_en: "English summary",
        published_at: "2026-06-13T10:36:00.000Z",
        url: "https://example.com/story",
      }),
    ).toEqual({
      title: "English title",
      link: "https://news.ax0x.ai/zh/items/38042",
      description: "English summary",
      pubDate: new Date("2026-06-13T10:36:00.000Z"),
      guid: "https://example.com/story",
    });
  });
});
