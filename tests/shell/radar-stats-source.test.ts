import { describe, expect, it } from "bun:test";
import { EMPTY_RADAR_STATS } from "@/lib/shell/radar-stats";
import { readSource } from "@/tests/helpers/source";

const RADAR_FALLBACK_PAGE_PATHS = [
  "app/[locale]/page.tsx",
  "app/[locale]/curated/page.tsx",
  "app/[locale]/sources/page.tsx",
  "app/[locale]/all/page.tsx",
  "app/[locale]/x-monitor/page.tsx",
  "app/[locale]/saved/page.tsx",
  "app/[locale]/agents/page.tsx",
  "app/[locale]/daily/page.tsx",
  "app/[locale]/daily/[date]/page.tsx",
  "app/[locale]/podcasts/page.tsx",
  "app/[locale]/podcasts/[id]/page.tsx",
  "app/[locale]/admin/policy/page.tsx",
  "app/[locale]/admin/usage/page.tsx",
  "app/[locale]/admin/users/page.tsx",
  "app/[locale]/admin/iterations/page.tsx",
  "app/[locale]/admin/system/page.tsx",
] as const;

const INLINE_EMPTY_RADAR_STATS_RE =
  /items_today:\s*0[\s\S]*?items_p1:\s*0[\s\S]*?items_featured:\s*0[\s\S]*?tracked_sources:\s*0/;

describe("radar stats shell contract", () => {
  it("defines the empty radar fallback once", () => {
    expect(EMPTY_RADAR_STATS).toEqual({
      items_today: 0,
      items_p1: 0,
      items_featured: 0,
      tracked_sources: 0,
    });
  });

  it("keeps the stats type owned by the shell contract, not the widget", () => {
    const widget = readSource("components/feed/radar-widget.tsx");
    const rightRail = readSource("components/feed/right-rail.tsx");
    const stats = readSource("lib/shell/dashboard-stats.ts");

    expect(widget).toContain("@/lib/shell/radar-stats");
    expect(rightRail).toContain("@/lib/shell/radar-stats");
    expect(stats).toContain("@/lib/shell/radar-stats");
    expect(widget).not.toContain("export type RadarStats");
  });

  it("keeps page fallbacks on the shared empty object", () => {
    for (const path of RADAR_FALLBACK_PAGE_PATHS) {
      const source = readSource(path);

      expect(source).toContain("@/lib/shell/radar-stats");
      expect(source).toContain("getRadarStats().catch(() => EMPTY_RADAR_STATS)");
      expect(source).not.toMatch(INLINE_EMPTY_RADAR_STATS_RE);
    }
  });
});
