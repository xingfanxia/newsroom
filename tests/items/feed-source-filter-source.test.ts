import { describe, expect, test } from "bun:test";
import {
  exportedFunctionSection,
  readSource as read,
} from "@/tests/helpers/source";

const liveSource = read("lib/items/live.ts");
const pageModelBuildersSrc = read("lib/public-content/page-model-builders.ts");

// Each reader page coerces its params, then a shared feed-query builder supplies
// both canonical and direct-artifact reads. Assert the page and query together.
const READER_PAGE_QUERIES: Record<string, string> = {
  "app/[locale]/page.tsx": "publicHomePageFeedQuery",
  "app/[locale]/all/page.tsx": "allPageFeedQuery",
  "app/[locale]/curated/page.tsx": "curatedPageFeedQuery",
  "app/[locale]/podcasts/page.tsx": "podcastsPageFeedQuery",
  "app/[locale]/x-monitor/page.tsx": "xMonitorPageFeedQuery",
};

describe("feed source filters source wiring", () => {
  test("sourceId is the exact-source filter and wins over preset buckets", () => {
    expect(liveSource).toContain("sourceId?: string");
    expect(liveSource).toContain("Takes precedence");
    expect(liveSource).toContain("!q.sourceId && q.sourceGroup");
    expect(liveSource).toContain("!q.sourceId && q.sourceKind");
  });

  test("reader pages pass exact source ids instead of matching publisher labels", () => {
    for (const [path, queryFn] of Object.entries(READER_PAGE_QUERIES)) {
      const source = `${read(path)}\n${exportedFunctionSection(
        pageModelBuildersSrc,
        queryFn,
      )}`;

      expect(source).toContain("sourceId");
      expect(source).not.toContain("source.publisher");
      expect(source).not.toContain("publisher ===");
      expect(source).not.toContain("publisher.includes");
    }
  });
});
