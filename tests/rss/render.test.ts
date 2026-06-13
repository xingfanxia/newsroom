import { describe, expect, it } from "bun:test";
import {
  renderMarkdownishHtml,
  renderRssFeed,
  rssResponse,
  type RssItem,
} from "@/lib/rss/render";

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

  it("renders channel namespaces and generator metadata", () => {
    const xml = renderRssFeed({
      ...baseChannel,
      items: [],
      generator: "AX Radar (news.ax0x.ai)",
      namespaces: {
        radar: "https://news.ax0x.ai/schemas/radar/1.0",
      },
    });

    expect(xml).toContain(
      'xmlns:radar="https://news.ax0x.ai/schemas/radar/1.0"',
    );
    expect(xml).toContain("<generator>AX Radar (news.ax0x.ai)</generator>");
  });

  it("renders item source, permalink guids, and escaped extra elements", () => {
    const item: RssItem = {
      title: "Story",
      link: "https://example.com/story",
      description: "summary",
      pubDate: new Date("2026-04-25T05:00:00Z"),
      guid: "https://example.com/story",
      guidIsPermalink: true,
      source: "A&B <source>",
      extraElements: [
        { name: "importance", value: 88 },
        { name: "tier", value: "featured" },
        { name: "crossSourceCount", value: 3 },
      ],
    };

    const xml = renderRssFeed({ ...baseChannel, items: [item] });

    expect(xml).toContain(
      '<guid isPermaLink="true">https://example.com/story</guid>',
    );
    expect(xml).toContain("<source>A&amp;B &lt;source&gt;</source>");
    expect(xml).toContain("<importance>88</importance>");
    expect(xml).toContain("<tier>featured</tier>");
    expect(xml).toContain("<crossSourceCount>3</crossSourceCount>");
  });

  it("renders items in the order given", () => {
    const items: RssItem[] = [
      { title: "First", link: "a", description: "", pubDate: new Date(), guid: "1" },
      { title: "Second", link: "b", description: "", pubDate: new Date(), guid: "2" },
    ];
    const xml = renderRssFeed({ ...baseChannel, items });
    expect(xml.indexOf("First")).toBeLessThan(xml.indexOf("Second"));
  });

  it("renders shared markdown-ish HTML for RSS bodies", () => {
    const html = renderMarkdownishHtml(`# Title\n\n- one\n- two\n\nplain & <text>`);

    expect(html).toContain("<h2>Title</h2>");
    expect(html).toContain("<ul><li>one</li>\n<li>two</li>\n</ul>");
    expect(html).toContain("<p>plain &amp; &lt;text&gt;</p>");
  });
});

describe("rssResponse", () => {
  it("wraps RSS XML with the shared content type and default cache policy", async () => {
    const res = rssResponse("<rss />");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(
      "application/rss+xml; charset=utf-8",
    );
    expect(res.headers.get("cache-control")).toBe(
      "public, max-age=600, s-maxage=600, stale-while-revalidate=3600",
    );
    expect(await res.text()).toBe("<rss />");
  });

  it("supports explicit cache policies for RSS variants", () => {
    const res = rssResponse("<rss />", { maxAge: 900 });

    expect(res.headers.get("cache-control")).toBe("public, max-age=900");
  });
});
