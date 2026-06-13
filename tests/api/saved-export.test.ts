import { describe, expect, test } from "bun:test";
import {
  parseSavedExportRequest,
  renderSavedExportMarkdown,
  savedExportFilename,
  savedExportMarkdownResponse,
  type SavedExportStory,
} from "@/lib/api/saved-export";
import type { SavedCollection } from "@/lib/items/collections";

const exportedAt = new Date("2026-06-13T12:00:00.000Z");

const collections: SavedCollection[] = [
  {
    id: 7,
    name: "Research",
    nameCjk: "研究",
    pinned: false,
    sortOrder: 0,
    count: 1,
    createdAt: "2026-06-01T00:00:00.000Z",
  },
];

const story: SavedExportStory = {
  sourceId: "mit-tech-review",
  source: {
    publisher: "MIT Technology Review",
    kindCode: "rss",
    localeCode: "en",
    groupCode: "media",
  },
  featured: true,
  title: "Open models move into production",
  summary: "A concise summary of the saved story.",
  tags: ["open-models"],
  importance: 87,
  tier: "featured",
  publishedAt: "2026-06-12T09:30:00.000Z",
  url: "https://example.test/open-models",
  locale: "en",
  editorNote: "This matters because deployment pressure is shifting.",
  editorAnalysis: "Longer analysis for the saved export.",
  reasoning: "High-signal strategy shift.",
  savedAt: "2026-06-12T10:00:00.000Z",
  collectionId: 7,
};

describe("saved export helpers", () => {
  test("parses saved export query params with legacy fallback behavior", () => {
    expect(
      parseSavedExportRequest(
        new Request("https://example.test/api/saved/export"),
      ),
    ).toEqual({ locale: "en", collection: null, suffix: "all" });

    expect(
      parseSavedExportRequest(
        new Request(
          "https://example.test/api/saved/export?collection=inbox&locale=zh",
        ),
      ),
    ).toEqual({ locale: "zh", collection: "inbox", suffix: "inbox" });

    expect(
      parseSavedExportRequest(
        new Request(
          "https://example.test/api/saved/export?collection=42&locale=fr",
        ),
      ),
    ).toEqual({ locale: "en", collection: 42, suffix: "coll-42" });

    expect(
      parseSavedExportRequest(
        new Request("https://example.test/api/saved/export?collection=0"),
      ),
    ).toEqual({ locale: "en", collection: null, suffix: "all" });
  });

  test("renders saved export markdown with collection title and editor fields", () => {
    const body = renderSavedExportMarkdown({
      locale: "en",
      collection: 7,
      stories: [story],
      collections,
      exportedAt,
    });

    expect(body).toContain("# Research");
    expect(body).toContain("> exported 2026-06-13 · 1 items");
    expect(body).toContain("## Open models move into production");
    expect(body).toContain(
      "- **MIT Technology Review** · Jun 12, 2026 · score `87` · `#Research`",
    );
    expect(body).toContain("- https://example.test/open-models");
    expect(body).toContain("> **Editor take**: This matters because");
    expect(body).toContain("**Sharp take**");
    expect(body).toContain("_Why featured: High-signal strategy shift._");
  });

  test("renders zh labels and CJK collection title when available", () => {
    const body = renderSavedExportMarkdown({
      locale: "zh",
      collection: 7,
      stories: [story],
      collections,
      exportedAt,
    });

    expect(body).toContain("# 研究");
    expect(body).toContain("> **一句话点评**");
    expect(body).toContain("**锐评**");
    expect(body).toContain("_精选理由: High-signal strategy shift._");
  });

  test("builds stable attachment response headers", async () => {
    const filename = savedExportFilename("all", exportedAt);
    const res = savedExportMarkdownResponse("body", filename);

    expect(filename).toBe("saved-all-2026-06-13.md");
    expect(res.headers.get("Content-Type")).toBe(
      "text/markdown; charset=utf-8",
    );
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="saved-all-2026-06-13.md"',
    );
    expect(await res.text()).toBe("body");
  });
});
