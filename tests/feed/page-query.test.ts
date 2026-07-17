import { describe, expect, it } from "bun:test";
import {
  capFeedPageItems,
  coerceFeedDateKey,
  coerceFeedOffset,
  feedPageLimitForDate,
  FEED_DATE_DRILLDOWN_LIMIT,
  FEED_PAGE_SIZE,
} from "@/lib/feed/page-query";
import { readSource } from "@/tests/helpers/source";

describe("feed page query coercion", () => {
  it("accepts YYYY-MM-DD date keys", () => {
    expect(coerceFeedDateKey("2026-06-17")).toBe("2026-06-17");
  });

  it("rejects non-date-key formats", () => {
    expect(coerceFeedDateKey(undefined)).toBeUndefined();
    expect(coerceFeedDateKey("2026-6-17")).toBeUndefined();
    expect(coerceFeedDateKey("2026-06-17T00:00:00Z")).toBeUndefined();
  });

  it("preserves the existing page behavior: date keys are format-only", () => {
    expect(coerceFeedDateKey("2026-99-99")).toBe("2026-99-99");
  });

  it("coerces offsets like the previous page-local parseInt logic", () => {
    expect(coerceFeedOffset(undefined)).toBe(0);
    expect(coerceFeedOffset("10")).toBe(10);
    expect(coerceFeedOffset("-1")).toBe(0);
    expect(coerceFeedOffset("abc")).toBe(0);
    expect(coerceFeedOffset("12abc")).toBe(12);
  });

  it("drops offsets beyond the bounded archive window", () => {
    expect(coerceFeedOffset("100000")).toBe(100000);
    expect(coerceFeedOffset("100001")).toBe(0);
  });

  it("uses the shared date drilldown cap and page-size default", () => {
    expect(feedPageLimitForDate(undefined)).toBe(FEED_PAGE_SIZE);
    expect(feedPageLimitForDate("2026-06-17")).toBe(
      FEED_DATE_DRILLDOWN_LIMIT,
    );
    expect(feedPageLimitForDate(undefined, 120)).toBe(120);
  });

  it("caps materialized rows from a previous 200-card release", () => {
    const legacyRows = Array.from({ length: 200 }, (_, index) => index);

    expect(capFeedPageItems(legacyRows)).toEqual(
      legacyRows.slice(0, FEED_PAGE_SIZE),
    );
    expect(capFeedPageItems(legacyRows.slice(0, 10))).toHaveLength(10);
  });
});

describe("feed page query parsing source ownership", () => {
  const pages = [
    "app/[locale]/page.tsx",
    "app/[locale]/all/page.tsx",
    "app/[locale]/curated/page.tsx",
  ];

  for (const page of pages) {
    it(`${page} imports the shared feed page query helper`, () => {
      const src = readSource(page);
      expect(src).toContain("@/lib/feed/page-query");
    });

    it(`${page} does not carry a page-local date regex`, () => {
      const src = readSource(page);
      expect(src).not.toContain("const DATE_RE");
      expect(src).not.toContain("/^\\d{4}-\\d{2}-\\d{2}$/");
    });
  }

  for (const page of ["app/[locale]/all/page.tsx", "app/[locale]/curated/page.tsx"]) {
    it(`${page} does not parse offset locally`, () => {
      const src = readSource(page);
      expect(src).not.toContain("Number.parseInt(sp.offset");
    });

    it(`${page} does not define the shared archive page size locally`, () => {
      const src = readSource(page);
      expect(src).not.toContain("const PAGE_SIZE = 200");
    });
  }
});
