import { describe, expect, it } from "vitest";
import { renderRssFeed, type RssItem } from "@/lib/rss/render";

describe("renderRssFeed", () => {
  const baseChannel = {
    title: "AX Radar Daily",
    link: "https://news.ax0x.ai/zh/daily",
    description: "Daily AI column",
    lastBuildDate: new Date("2026-04-25T05:00:00Z"),
  };

  it("renders valid RSS 2.0 envelope", () => {
    const xml = renderRssFeed({ ...baseChannel, items: [] });
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain('<rss version="2.0"');
    expect(xml).toContain("<channel>");
    expect(xml).toContain('xmlns:content="http://purl.org/rss/1.0/modules/content/"');
  });

  it("escapes HTML entities in titles + descriptions", () => {
    const item: RssItem = {
      title: "Bug & feature: <html>",
      link: "https://example.com/x",
      description: "A 'tricky' & <case>",
      pubDate: new Date(),
      guid: "1",
    };
    const xml = renderRssFeed({ ...baseChannel, items: [item] });
    expect(xml).toContain("Bug &amp; feature: &lt;html&gt;");
    expect(xml).toContain("A &apos;tricky&apos; &amp; &lt;case&gt;");
  });

  it("wraps content:encoded in CDATA", () => {
    const item: RssItem = {
      title: "x",
      link: "https://example.com/y",
      description: "",
      pubDate: new Date(),
      guid: "2",
      contentEncoded: "<p>hello <strong>world</strong></p>",
    };
    const xml = renderRssFeed({ ...baseChannel, items: [item] });
    expect(xml).toMatch(
      /<content:encoded><!\[CDATA\[<p>hello <strong>world<\/strong><\/p>\]\]><\/content:encoded>/,
    );
  });

  it("escapes embedded ]]> in CDATA content", () => {
    const item: RssItem = {
      title: "x",
      link: "https://example.com/y",
      description: "",
      pubDate: new Date(),
      guid: "3",
      contentEncoded: "evil ]]> stuff",
    };
    const xml = renderRssFeed({ ...baseChannel, items: [item] });
    // Should split the ]]> sequence so it doesn't terminate the CDATA early
    expect(xml).not.toMatch(/<!\[CDATA\[evil \]\]>/);
    expect(xml).toContain("]]]]><![CDATA[>");
  });

  it("includes atom:self link", () => {
    const xml = renderRssFeed({
      ...baseChannel,
      items: [],
      selfLink: "https://news.ax0x.ai/api/rss/daily.xml",
    });
    expect(xml).toContain('<atom:link href="https://news.ax0x.ai/api/rss/daily.xml"');
    expect(xml).toContain('rel="self"');
  });

  it("renders items in the order given", () => {
    const items: RssItem[] = [
      { title: "First", link: "a", description: "", pubDate: new Date(), guid: "1" },
      { title: "Second", link: "b", description: "", pubDate: new Date(), guid: "2" },
    ];
    const xml = renderRssFeed({ ...baseChannel, items });
    expect(xml.indexOf("First")).toBeLessThan(xml.indexOf("Second"));
  });
});
