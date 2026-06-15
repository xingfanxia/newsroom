import { describe, expect, test } from "bun:test";
import { readSource as read } from "@/tests/helpers/source";

const liveSource = read("lib/items/live.ts");

describe("feed source filters source wiring", () => {
  test("sourceId is the exact-source filter and wins over preset buckets", () => {
    expect(liveSource).toContain("sourceId?: string");
    expect(liveSource).toContain("Takes precedence");
    expect(liveSource).toContain("!q.sourceId && q.sourceGroup");
    expect(liveSource).toContain("!q.sourceId && q.sourceKind");
  });

  test("reader pages pass exact source ids instead of matching publisher labels", () => {
    const pages = [
      "app/[locale]/page.tsx",
      "app/[locale]/all/page.tsx",
      "app/[locale]/curated/page.tsx",
      "app/[locale]/podcasts/page.tsx",
      "app/[locale]/x-monitor/page.tsx",
    ];

    for (const path of pages) {
      const source = read(path);

      expect(source).toContain("sourceId");
      expect(source).not.toContain("source.publisher");
      expect(source).not.toContain("publisher ===");
      expect(source).not.toContain("publisher.includes");
    }
  });
});
