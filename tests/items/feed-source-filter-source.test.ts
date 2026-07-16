import { describe, expect, test } from "bun:test";
import {
  exportedFunctionSection,
  readSource as read,
} from "@/tests/helpers/source";

const liveSource = read("lib/items/live.ts");
const pageModelBuildersSrc = read("lib/public-content/page-model-builders.ts");

// Each reader page coerces its params, then a page-model builder runs the feed
// query. The exact-source-id filter lives in the page (home/all/curated) or in
// the builder (podcasts keys off activeChannel, x-monitor off the handle), so
// the invariant is asserted over the page AND its builder together.
const READER_PAGE_BUILDERS: Record<string, string> = {
  "app/[locale]/page.tsx": "buildPublicHomePageModelFromSnapshot",
  "app/[locale]/all/page.tsx": "buildAllPageModel",
  "app/[locale]/curated/page.tsx": "buildCuratedPageModel",
  "app/[locale]/podcasts/page.tsx": "buildPodcastsPageModel",
  "app/[locale]/x-monitor/page.tsx": "buildXMonitorPageModel",
};

describe("feed source filters source wiring", () => {
  test("sourceId is the exact-source filter and wins over preset buckets", () => {
    expect(liveSource).toContain("sourceId?: string");
    expect(liveSource).toContain("Takes precedence");
    expect(liveSource).toContain("!q.sourceId && q.sourceGroup");
    expect(liveSource).toContain("!q.sourceId && q.sourceKind");
  });

  test("reader pages pass exact source ids instead of matching publisher labels", () => {
    for (const [path, builderFn] of Object.entries(READER_PAGE_BUILDERS)) {
      const source = `${read(path)}\n${exportedFunctionSection(
        pageModelBuildersSrc,
        builderFn,
      )}`;

      expect(source).toContain("sourceId");
      expect(source).not.toContain("source.publisher");
      expect(source).not.toContain("publisher ===");
      expect(source).not.toContain("publisher.includes");
    }
  });
});
