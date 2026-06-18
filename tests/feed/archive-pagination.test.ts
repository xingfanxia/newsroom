import { describe, expect, it } from "bun:test";
import { feedArchivePageHref } from "@/components/feed/archive-pagination";
import { readSource } from "@/tests/helpers/source";

const ARCHIVE_PAGES = [
  {
    path: "app/[locale]/all/page.tsx",
    basePath: 'basePath={`/${appLocale}/all`}',
  },
  {
    path: "app/[locale]/curated/page.tsx",
    basePath: 'basePath={`/${appLocale}/curated`}',
  },
] as const;

describe("feed archive pagination hrefs", () => {
  it("omits offset on the first page", () => {
    expect(feedArchivePageHref("/zh/all", 0)).toBe("/zh/all");
  });

  it("preserves source filters before adding the next offset", () => {
    expect(
      feedArchivePageHref("/zh/all", 200, {
        source: "media",
      }),
    ).toBe("/zh/all?source=media&offset=200");
  });

  it("preserves exact source ids and skips empty values", () => {
    expect(
      feedArchivePageHref("/en/curated", 400, {
        source_id: "yage-share",
        source: undefined,
        ignored: "",
      }),
    ).toBe("/en/curated?source_id=yage-share&offset=400");
  });
});

describe("feed archive pagination source ownership", () => {
  it("keeps shared pagination styling and labels in one component", () => {
    const source = readSource("components/feed/archive-pagination.tsx");

    expect(source).toContain("export function FeedArchivePagination");
    expect(source).toContain("export function feedArchivePageHref");
    expect(source).toContain('className="mini-btn"');
    expect(source).toContain('aria-label={zh ? "分页" : "pagination"}');
    expect(source).toContain('padding: "18px 0 40px"');
  });

  for (const page of ARCHIVE_PAGES) {
    it(`${page.path} delegates archive pagination to the shared component`, () => {
      const source = readSource(page.path);

      expect(source).toContain("@/components/feed/archive-pagination");
      expect(source).toContain("<FeedArchivePagination");
      expect(source).toContain(page.basePath);
      expect(source).not.toContain("function Pagination");
      expect(source).not.toContain("new URLSearchParams");
      expect(source).not.toContain('className="mini-btn"');
    });
  }

  it("curated exposes pagination for its existing offset-based archive query", () => {
    const source = readSource("app/[locale]/curated/page.tsx");

    expect(source).toContain("FEED_PAGE_SIZE");
    expect(source).toContain("offset={offset}");
    expect(source).toContain('preservedParams={{ source_id: sourceId }}');
  });
});
