import { describe, expect, test } from "bun:test";
import {
  parseNewsletterRssLocale,
  structuredNewsletterRssItem,
} from "@/lib/rss/newsletter-feed";

describe("newsletter RSS feed helpers", () => {
  test("parses newsletter RSS locales with zh fallback", () => {
    expect(parseNewsletterRssLocale("en")).toBe("en");
    expect(parseNewsletterRssLocale("zh")).toBe("zh");
    expect(parseNewsletterRssLocale("fr")).toBe("zh");
    expect(parseNewsletterRssLocale("")).toBe("zh");
  });

  test("maps structured legacy newsletter rows to RSS items", () => {
    const item = structuredNewsletterRssItem(
      {
        id: 42,
        kind: "monthly",
        headline: "A&B <headline>",
        overview: "Overview & intro",
        highlights: "- one\n- two",
        commentary: "## Take\n\nsharp & clear",
        storyCount: 7,
        periodStart: new Date("2026-05-01T00:00:00.000Z"),
        periodEnd: new Date("2026-06-01T00:00:00.000Z"),
        publishedAt: new Date("2026-06-01T09:00:00.000Z"),
      },
      "en",
    );

    expect(item.title).toBe("[Monthly] A&B <headline>");
    expect(item.link).toBe("https://news.ax0x.ai/en/newsletter/42");
    expect(item.description).toBe("Overview & intro");
    expect(item.pubDate).toEqual(new Date("2026-06-01T09:00:00.000Z"));
    expect(item.guid).toBe("newsletter-42");
    expect(item.category).toBe("Monthly");
    expect(item.contentEncoded).toContain("<h2>A&amp;B &lt;headline&gt;</h2>");
    expect(item.contentEncoded).toContain("<strong>Overview</strong>");
    expect(item.contentEncoded).toContain("<ul><li>one</li>");
    expect(item.contentEncoded).toContain("<h3>Take</h3>");
    expect(item.contentEncoded).toContain(
      "<em>Covered 7 stories · May 1 – May 31</em>",
    );
  });
});
