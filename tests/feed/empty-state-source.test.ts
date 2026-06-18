import { describe, expect, it } from "bun:test";
import { readSource } from "@/tests/helpers/source";

const FEED_EMPTY_STATE_PAGES = [
  "app/[locale]/page.tsx",
  "app/[locale]/all/page.tsx",
  "app/[locale]/curated/page.tsx",
  "app/[locale]/podcasts/page.tsx",
  "app/[locale]/x-monitor/page.tsx",
  "app/[locale]/saved/page.tsx",
] as const;

describe("feed empty state source ownership", () => {
  it("keeps the common empty-state visual treatment in one component", () => {
    const source = readSource("components/feed/empty-state.tsx");

    expect(source).toContain("export function FeedEmptyState");
    expect(source).toContain("padding: 60");
    expect(source).toContain('color: "var(--fg-3)"');
    expect(source).toContain('textAlign: "center"');
    expect(source).toContain("framed");
    expect(source).toContain('border: "1px dashed var(--border-1)"');
  });

  for (const page of FEED_EMPTY_STATE_PAGES) {
    it(`${page} uses FeedEmptyState instead of local empty-state styling`, () => {
      const source = readSource(page);

      expect(source).toContain("@/components/feed/empty-state");
      expect(source).toContain("<FeedEmptyState");
      expect(source).not.toContain("padding: 60");
      expect(source).not.toContain("<div style={{ padding: 60");
    });
  }

  it("saved keeps its framed empty state explicit", () => {
    const source = readSource("app/[locale]/saved/page.tsx");

    expect(source).toContain("<FeedEmptyState framed>");
  });
});
