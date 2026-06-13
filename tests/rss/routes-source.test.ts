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

describe("RSS route source contracts", () => {
  test("RSS routes share the envelope renderer", () => {
    for (const route of [mainFeedRoute, newsletterFeedRoute, dailyFeedRoute]) {
      expect(route).toContain("@/lib/rss/render");
      expect(route).toContain("renderRssFeed");
    }
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
});
