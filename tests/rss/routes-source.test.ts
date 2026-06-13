import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

const mainFeedRoute = read("app/api/feed/[locale]/rss.xml/route.ts");
const newsletterFeedRoute = read(
  "app/api/feed/newsletter/[locale]/rss.xml/route.ts",
);
const dailyFeedRoute = read("app/api/rss/[slug]/route.ts");
const legacyFeeds = read("lib/rss/legacy-feeds.ts");

describe("RSS route source contracts", () => {
  test("RSS routes share the envelope renderer", () => {
    for (const route of [mainFeedRoute, newsletterFeedRoute]) {
      expect(route).toContain("@/lib/rss/render");
      expect(route).toContain("renderRssFeed");
      expect(route).toContain("rssResponse");
      expect(route).not.toContain("new NextResponse(xml");
      expect(route).not.toContain("new Response(xml");
      expect(route).not.toContain("application/rss+xml; charset=utf-8");
    }

    expect(dailyFeedRoute).toContain("@/lib/rss/render");
    expect(dailyFeedRoute).toContain("rssResponse");
    expect(dailyFeedRoute).not.toContain("new NextResponse(xml");
    expect(dailyFeedRoute).not.toContain("new Response(xml");
    expect(dailyFeedRoute).not.toContain("application/rss+xml; charset=utf-8");
  });

  test("legacy RSS routes do not hand-roll XML escaping or markdown rendering", () => {
    for (const route of [mainFeedRoute, newsletterFeedRoute]) {
      expect(route).toContain("renderMarkdownishHtml");
      expect(route).not.toContain("function buildRss");
      expect(route).not.toContain("function mdToHtml");
      expect(route).not.toContain("function escape(");
      expect(route).not.toContain("content:encoded><![CDATA[");
      expect(route).not.toContain("new Date().toUTCString()");
    }
  });

  test("main feed keeps radar metadata through renderer extensions", () => {
    expect(mainFeedRoute).toContain("namespaces");
    expect(mainFeedRoute).toContain("radar");
    expect(mainFeedRoute).toContain("extraElements");
    expect(mainFeedRoute).toContain("guidIsPermalink: true");
  });

  test("legacy slug RSS route delegates feed construction to a shared helper", () => {
    expect(dailyFeedRoute).toContain("@/lib/rss/legacy-feeds");
    expect(dailyFeedRoute).toContain("parseLegacyRssSlug");
    expect(dailyFeedRoute).toContain("renderLegacyRssFeed");
    expect(dailyFeedRoute).not.toContain("FEED_META");
    expect(dailyFeedRoute).not.toContain("renderDailyFeed");
    expect(dailyFeedRoute).not.toContain("renderLaneFeed");
    expect(dailyFeedRoute).not.toContain("listDailyColumnRows");
    expect(dailyFeedRoute).not.toContain("from items");
    expect(dailyFeedRoute).not.toContain("FROM items");
    expect(dailyFeedRoute).not.toContain("JOIN sources");
    expect(dailyFeedRoute).not.toContain(".execute(sql");

    expect(legacyFeeds).toContain("renderRssFeed");
    expect(legacyFeeds).toContain("listDailyColumnRows");
    expect(legacyFeeds).toContain("dailyColumnRssItem");
    expect(legacyFeeds).toContain("legacyLaneRssItem");
  });
});
