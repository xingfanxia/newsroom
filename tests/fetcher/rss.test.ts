import { describe, expect, it } from "bun:test";
import { parseFeed } from "@/workers/fetcher/rss";

const RSS_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Test Feed</title>
  <link>https://example.com</link>
  <item>
    <title>Hello World</title>
    <link>https://example.com/post/1</link>
    <guid isPermaLink="false">example-1</guid>
    <pubDate>Mon, 14 Apr 2026 12:00:00 GMT</pubDate>
    <description><![CDATA[<p>Body <b>here</b></p>]]></description>
  </item>
  <item>
    <title>Second</title>
    <link>https://example.com/post/2</link>
    <guid isPermaLink="false">example-2</guid>
  </item>
</channel></rss>`;

const ATOM_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Feed</title>
  <entry>
    <id>tag:example.com,2026:atom-1</id>
    <title>Atom One</title>
    <link href="https://example.com/atom/1" rel="alternate"/>
    <published>2026-04-15T09:00:00Z</published>
    <content>Hello atom</content>
  </entry>
  <entry>
    <id>tag:example.com,2026:atom-2</id>
    <title>Atom Two</title>
    <link href="https://example.com/atom/2"/>
    <updated>2026-04-16T09:00:00Z</updated>
  </entry>
</feed>`;

describe("parseFeed (RSS)", () => {
  it("parses basic RSS 2.0", () => {
    const items = parseFeed(RSS_SAMPLE);
    expect(items).toHaveLength(2);
    expect(items[0].externalId).toBe("example-1");
    expect(items[0].title).toBe("Hello World");
    expect(items[0].url).toBe("https://example.com/post/1");
    expect(items[0].publishedAt).toBeInstanceOf(Date);
  });

  it("tolerates missing pubDate", () => {
    const items = parseFeed(RSS_SAMPLE);
    expect(items[1].publishedAt).toBeNull();
  });
});

describe("parseFeed (Atom)", () => {
  it("parses basic Atom 1.0", () => {
    const items = parseFeed(ATOM_SAMPLE);
    expect(items).toHaveLength(2);
    expect(items[0].externalId).toBe("tag:example.com,2026:atom-1");
    expect(items[0].url).toBe("https://example.com/atom/1");
    expect(items[0].publishedAt?.toISOString()).toBe("2026-04-15T09:00:00.000Z");
  });

  it("uses updated when published missing", () => {
    const items = parseFeed(ATOM_SAMPLE);
    expect(items[1].publishedAt?.toISOString()).toBe("2026-04-16T09:00:00.000Z");
  });
});

describe("parseFeed (invalid)", () => {
  it("throws on non-feed input", () => {
    expect(() => parseFeed("<html></html>")).toThrow();
  });

  it("returns empty array for atom feed with no entries", () => {
    const empty = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>x</title></feed>`;
    expect(parseFeed(empty)).toEqual([]);
  });
});
