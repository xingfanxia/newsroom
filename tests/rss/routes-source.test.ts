import { describe, expect, test } from "bun:test";
import { readSource as read } from "@/tests/helpers/source";

const mainFeedRoute = read("app/api/feed/[locale]/rss.xml/route.ts");
const newsletterFeedRoute = read(
  "app/api/feed/newsletter/[locale]/rss.xml/route.ts",
);
const dailyFeedRoute = read("app/api/rss/[slug]/route.ts");
const agentsTabs = read("app/[locale]/agents/_tabs.tsx");
const legacyFeedMeta = read("lib/rss/legacy-feed-meta.ts");
const legacyFeeds = read("lib/rss/legacy-feeds.ts");
const newsletterFeed = read("lib/rss/newsletter-feed.ts");

describe("RSS route source contracts", () => {
  test("RSS routes share the envelope renderer", () => {
    for (const route of [mainFeedRoute]) {
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

    expect(newsletterFeedRoute).toContain("@/lib/rss/render");
    expect(newsletterFeedRoute).toContain("rssResponse");
    expect(newsletterFeedRoute).not.toContain("new NextResponse(xml");
    expect(newsletterFeedRoute).not.toContain("new Response(xml");
    expect(newsletterFeedRoute).not.toContain(
      "application/rss+xml; charset=utf-8",
    );
  });

  test("legacy RSS routes do not hand-roll XML escaping or markdown rendering", () => {
    for (const source of [mainFeedRoute, newsletterFeed]) {
      expect(source).toContain("renderMarkdownishHtml");
      expect(source).not.toContain("function buildRss");
      expect(source).not.toContain("function mdToHtml");
      expect(source).not.toContain("function escape(");
      expect(source).not.toContain("content:encoded><![CDATA[");
      expect(source).not.toContain("new Date().toUTCString()");
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

    expect(legacyFeeds).toContain("@/lib/rss/legacy-feed-meta");
    expect(legacyFeeds).toContain("renderRssFeed");
    expect(legacyFeeds).toContain("listDailyColumnRows");
    expect(legacyFeeds).toContain("dailyColumnRssItem");
    expect(legacyFeeds).toContain("legacyLaneRssItem");
  });

  test("legacy RSS metadata is shared by RSS rendering and the agents page", () => {
    expect(legacyFeedMeta).toContain("LEGACY_RSS_FEEDS");
    expect(legacyFeedMeta).toContain("/api/rss/today.xml");
    expect(legacyFeedMeta).toContain("/api/rss/curated.xml");
    expect(legacyFeedMeta).toContain("/api/rss/daily.xml");

    for (const source of [legacyFeeds, agentsTabs]) {
      expect(source).toContain("@/lib/rss/legacy-feed-meta");
      expect(source).not.toContain("/api/rss/today.xml");
      expect(source).not.toContain("/api/rss/curated.xml");
      expect(source).not.toContain("/api/rss/daily.xml");
    }
  });

  test("legacy newsletter RSS route delegates digest construction to a shared helper", () => {
    expect(newsletterFeedRoute).toContain("@/lib/rss/newsletter-feed");
    expect(newsletterFeedRoute).toContain("parseNewsletterRssLocale");
    expect(newsletterFeedRoute).toContain("renderStructuredNewsletterRssFeed");
    expect(newsletterFeedRoute).not.toContain("@/db/client");
    expect(newsletterFeedRoute).not.toContain("@/db/schema");
    expect(newsletterFeedRoute).not.toContain("from(newsletters)");
    expect(newsletterFeedRoute).not.toContain("newsletters.headline");
    expect(newsletterFeedRoute).not.toContain("BRAND");
    expect(newsletterFeedRoute).not.toContain("DESCRIPTION");
    expect(newsletterFeedRoute).not.toContain("formatRange");

    expect(newsletterFeed).toContain("renderRssFeed");
    expect(newsletterFeed).toContain("structuredNewsletterRssItem");
    expect(newsletterFeed).toContain("headline} IS NOT NULL");
  });
});
