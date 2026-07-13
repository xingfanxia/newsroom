import { describe, expect, test } from "bun:test";
import { readSource as read } from "@/tests/helpers/source";

const mainFeedRoute = read("app/api/feed/[locale]/rss.xml/route.ts");
const newsletterFeedRoute = read(
  "app/api/feed/newsletter/[locale]/rss.xml/route.ts",
);
const dailyFeedRoute = read("app/api/rss/[slug]/route.ts");
const appLayout = read("app/[locale]/layout.tsx");
const agentsTabs = read("app/[locale]/agents/_tabs.tsx");
const homeFilters = read("app/[locale]/_home-filters.tsx");
const mainFeed = read("lib/rss/main-feed.ts");
const mainFeedMeta = read("lib/rss/main-feed-meta.ts");
const rssHttpContract = read("lib/rss/http-contract.ts");
const rssRateLimit = read("lib/rate-limit/rss.ts");
const rssRenderer = read("lib/rss/render.ts");
const legacyFeedMeta = read("lib/rss/legacy-feed-meta.ts");
const legacyFeeds = read("lib/rss/legacy-feeds.ts");
const newsletterFeed = read("lib/rss/newsletter-feed.ts");

describe("RSS route source contracts", () => {
  test("RSS routes share the HTTP response envelope", () => {
    for (const route of [mainFeedRoute, dailyFeedRoute, newsletterFeedRoute]) {
      expect(route).toContain("@/lib/rss/render");
      expect(route).toContain("rssResponse");
      expect(route).not.toContain("new NextResponse(xml");
      expect(route).not.toContain("new Response(xml");
      expect(route).not.toContain("application/rss+xml; charset=utf-8");
      expect(route).not.toContain("maxAge:");
      expect(route).not.toContain("sMaxAge:");
      expect(route).not.toContain("staleWhileRevalidate:");
    }
  });

  test("RSS feed helpers share the XML renderer", () => {
    expect(rssRenderer).toContain("@/lib/rss/http-contract");
    expect(rssRenderer).toContain("appLocaleLanguageTag(DEFAULT_APP_LOCALE)");
    expect(rssRenderer).not.toContain('?? "zh-CN"');

    for (const helper of [mainFeed, legacyFeeds, newsletterFeed]) {
      expect(helper).toContain("@/lib/rss/render");
      expect(helper).toContain("renderRssFeed");
      expect(helper).not.toContain("new NextResponse(xml");
      expect(helper).not.toContain("new Response(xml");
      expect(helper).not.toContain("application/rss+xml; charset=utf-8");
    }
  });

  test("legacy RSS routes do not hand-roll XML escaping or markdown rendering", () => {
    for (const source of [mainFeed, newsletterFeed]) {
      expect(source).toContain("renderMarkdownishHtml");
      expect(source).not.toContain("function buildRss");
      expect(source).not.toContain("function mdToHtml");
      expect(source).not.toContain("function escape(");
      expect(source).not.toContain("content:encoded><![CDATA[");
      expect(source).not.toContain("new Date().toUTCString()");
    }
  });

  test("main feed keeps radar metadata through renderer extensions", () => {
    expect(mainFeed).toContain("namespaces");
    expect(mainFeed).toContain("radar");
    expect(mainFeed).toContain("extraElements");
    expect(mainFeed).toContain("guidIsPermalink: true");
  });

  test("main feed RSS route delegates feed construction to a shared helper", () => {
    expect(mainFeedRoute).toContain("@/lib/rss/main-feed");
    expect(mainFeedRoute).toContain("renderMainRssFeed");
    expect(mainFeedRoute).not.toContain("@/lib/items/live");
    expect(mainFeedRoute).not.toContain("getFeaturedStories");
    expect(mainFeedRoute).not.toContain("renderRssFeed");
    expect(mainFeedRoute).not.toContain("renderMarkdownishHtml");
    expect(mainFeedRoute).not.toContain("RssItem");
    expect(mainFeedRoute).not.toContain("PUBLIC_SITE_HOST");

    expect(mainFeed).toContain("getFeaturedStories");
    expect(mainFeed).toContain("renderMainRssFeed");
    expect(mainFeed).toContain("mainRssItem");
  });

  test("main feed RSS metadata is shared by helper, route, layout, home filters, and agents page", () => {
    expect(mainFeedMeta).toContain("MAIN_RSS_FEEDS");
    expect(mainFeedMeta).toContain("appLocaleLanguageTag");
    expect(mainFeedMeta).toContain("/api/feed/zh/rss.xml");
    expect(mainFeedMeta).toContain("/api/feed/en/rss.xml");
    expect(mainFeedMeta).not.toContain('language: "zh-CN"');
    expect(mainFeedMeta).not.toContain('language: "en-US"');

    for (const source of [
      mainFeed,
      mainFeedRoute,
      appLayout,
      homeFilters,
      agentsTabs,
    ]) {
      expect(source).toContain("@/lib/rss/main-feed-meta");
      expect(source).not.toContain("/api/feed/zh/rss.xml");
      expect(source).not.toContain("/api/feed/en/rss.xml");
    }

    expect(mainFeed).not.toContain("const BRAND");
    expect(mainFeed).not.toContain("const DESCRIPTION");
  });

  test("legacy slug RSS route delegates feed construction to a shared helper", () => {
    expect(dailyFeedRoute).toContain("@/lib/rss/legacy-feeds");
    expect(dailyFeedRoute).toContain("parseLegacyRssSlug");
    expect(dailyFeedRoute).toContain("renderLegacyRssFeedCached");
    expect(dailyFeedRoute).not.toContain("FEED_META");
    expect(dailyFeedRoute).not.toContain("renderDailyFeed");
    expect(dailyFeedRoute).not.toContain("renderLaneFeed");
    expect(dailyFeedRoute).not.toContain("listDailyColumnRows");
    expect(dailyFeedRoute).not.toContain("from items");
    expect(dailyFeedRoute).not.toContain("FROM items");
    expect(dailyFeedRoute).not.toContain("JOIN sources");
    expect(dailyFeedRoute).not.toContain(".execute(sql");

    expect(legacyFeeds).toContain("@/lib/rss/legacy-feed-meta");
    expect(legacyFeeds).toContain("listDailyColumnRows");
    expect(legacyFeeds).toContain("dailyColumnRssItem");
    expect(legacyFeeds).toContain("legacyLaneRssItem");
  });

  test("legacy RSS metadata is shared by RSS rendering and the agents page", () => {
    expect(legacyFeedMeta).toContain("LEGACY_RSS_FEEDS");
    expect(legacyFeedMeta).toContain("/api/rss/today.xml");
    expect(legacyFeedMeta).toContain("/api/rss/curated.xml");
    expect(legacyFeedMeta).toContain("/api/rss/daily.xml");
    expect(legacyFeedMeta).toContain("@/lib/daily-column/routes");
    expect(legacyFeedMeta).not.toContain("@/lib/api/daily-columns");

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

  test("agents RSS technical notes derive HTTP labels from shared runtime contracts", () => {
    expect(rssHttpContract).toContain("RSS_CONTENT_TYPE");
    expect(rssHttpContract).toContain("RSS_DEFAULT_CACHE");
    expect(rssHttpContract).toContain("RSS_RATE_LIMIT_MAX");
    expect(rssHttpContract).toContain("rssCacheControl");
    expect(rssHttpContract).toContain("rssRateLimitReqLabel");
    expect(rssRateLimit).toContain("@/lib/rss/http-contract");

    expect(agentsTabs).toContain("@/lib/rss/http-contract");
    expect(agentsTabs).toContain("RSS_CONTENT_TYPE");
    expect(agentsTabs).toContain("rssCacheControl");
    expect(agentsTabs).toContain("rssRateLimitReqLabel");

    expect(agentsTabs).not.toContain("@/lib/rss/render");
    expect(agentsTabs).not.toContain("@/lib/rate-limit/rss");
    expect(agentsTabs).not.toContain("application/rss+xml");
    expect(agentsTabs).not.toContain("s-maxage=600");
    expect(agentsTabs).not.toContain("stale-while-revalidate=3600");
    expect(agentsTabs).not.toContain("60 req/h");
  });
});
