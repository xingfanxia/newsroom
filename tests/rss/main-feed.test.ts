import { describe, expect, test } from "bun:test";
import {
  buildMainRssContentHtml,
  mainRssItem,
} from "@/lib/rss/main-feed";
import type { Story } from "@/lib/types";

const baseStory: Story = {
  id: "1",
  sourceId: "openai-blog",
  source: {
    publisher: "OpenAI",
    kindCode: "rss",
    localeCode: "en",
  },
  featured: true,
  title: "Model update",
  summary: "Short <summary>",
  tags: ["Product update", "Reasoning"],
  importance: 88,
  tier: "featured",
  publishedAt: "2026-06-18T10:00:00.000Z",
  url: "https://example.com/model-update",
  locale: "en",
  editorNote: "Worth <watching>",
  editorAnalysis: "## Why it matters\n\n- first\n- second",
  hkr: { h: true, k: false, r: true },
};

describe("main RSS feed construction", () => {
  test("renders main feed content HTML with escaped note and markdown analysis", () => {
    const html = buildMainRssContentHtml(baseStory);

    expect(html).toContain("Worth &lt;watching&gt;");
    expect(html).toContain("<p>Short &lt;summary&gt;</p>");
    expect(html).toContain("<h3>Why it matters</h3>");
    expect(html).toContain("<ul><li>first</li>");
  });

  test("maps story fields into RSS item metadata and radar extension values", () => {
    const item = mainRssItem({ ...baseStory, crossSourceCount: 3 });

    expect(item).toMatchObject({
      title: "Model update",
      link: "https://example.com/model-update",
      description: "Short <summary>",
      guid: "https://example.com/model-update",
      guidIsPermalink: true,
      source: "OpenAI",
      category: "Product update, Reasoning",
    });
    expect(item.pubDate.toISOString()).toBe("2026-06-18T10:00:00.000Z");
    expect(item.extraElements).toEqual([
      { name: "importance", value: 88 },
      { name: "tier", value: "featured" },
      { name: "crossSourceCount", value: 3 },
    ]);
  });
});
