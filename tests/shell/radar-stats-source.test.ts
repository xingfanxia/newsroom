import { describe, expect, it } from "bun:test";
import { EMPTY_RADAR_STATS } from "@/lib/shell/radar-stats";
import {
  DEFAULT_SIGNAL_RATIO,
  signalRatioFromRadar,
  topBarStatsFromRadar,
} from "@/lib/shell/top-bar-stats";
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

const PULSE_CHROME_PAGE_PATHS = [
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
] as const;

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

  it("keeps shell chrome fallbacks on the shared empty object", () => {
    const chromeData = readSource("lib/shell/chrome-data.ts");

    // W8b: the shell reads the cached radar/pulse wrappers (lib/shell/feed-cache)
    // so the chrome stats dedupe across renders — the empty-object fallback
    // contract is unchanged.
    expect(chromeData).toContain("@/lib/shell/radar-stats");
    expect(chromeData).toContain(
      "getRadarStatsCached().catch(() => EMPTY_RADAR_STATS)",
    );
    expect(chromeData).toContain("getPulseDataCached().catch(() => [])");
    expect(chromeData).not.toMatch(INLINE_EMPTY_RADAR_STATS_RE);
  });

  it("keeps page chrome loading on the shared shell helper", () => {
    for (const path of RADAR_FALLBACK_PAGE_PATHS) {
      const source = readSource(path);

      expect(source).toContain("@/lib/shell/chrome-data");
      expect(source).not.toContain("@/lib/shell/radar-stats");
      expect(source).not.toContain("getRadarStats().catch");
      expect(source).not.toMatch(INLINE_EMPTY_RADAR_STATS_RE);
    }
  });

  it("keeps pulse-enabled pages explicit about loading pulse data", () => {
    for (const path of PULSE_CHROME_PAGE_PATHS) {
      const source =
        path === "app/[locale]/saved/page.tsx"
          ? `${readSource(path)}\n${readSource("lib/auth/saved-page-boundary.ts")}`
          : readSource(path);

      expect(source).toMatch(/getShellChromeData(?:\(|:)\s*\{ pulse: true/);
      expect(source).toContain("pulse={chrome.pulse}");
    }
  });

  it("maps radar stats into top-bar stats with one shared default ratio", () => {
    expect(
      topBarStatsFromRadar({
        items_today: 20,
        items_p1: 3,
        items_featured: 7,
        tracked_sources: 41,
      }),
    ).toEqual({
      tracked_sources: 41,
      signal_ratio: DEFAULT_SIGNAL_RATIO,
    });

    expect(
      topBarStatsFromRadar(
        {
          items_today: 20,
          items_p1: 3,
          items_featured: 7,
          tracked_sources: 41,
        },
        0.5,
      ),
    ).toEqual({
      tracked_sources: 41,
      signal_ratio: 0.5,
    });

    expect(
      signalRatioFromRadar({
        items_today: 20,
        items_p1: 3,
        items_featured: 7,
        tracked_sources: 41,
      }),
    ).toBe(0.5);
    expect(signalRatioFromRadar(EMPTY_RADAR_STATS)).toBe(DEFAULT_SIGNAL_RATIO);
  });

  it("keeps signal ratios within top-bar display bounds", () => {
    expect(
      signalRatioFromRadar({
        items_today: 10,
        items_p1: 8,
        items_featured: 8,
        tracked_sources: 41,
      }),
    ).toBe(1);
    expect(
      topBarStatsFromRadar(
        {
          items_today: 10,
          items_p1: 1,
          items_featured: 1,
          tracked_sources: 41,
        },
        1.5,
      ).signal_ratio,
    ).toBe(1);
    expect(topBarStatsFromRadar(EMPTY_RADAR_STATS, -0.2).signal_ratio).toBe(0);
    expect(
      topBarStatsFromRadar(EMPTY_RADAR_STATS, Number.NaN).signal_ratio,
    ).toBe(DEFAULT_SIGNAL_RATIO);
  });

  it("keeps radar top-bar numerator counts in the same 24h window as items_today", () => {
    const stats = readSource("lib/shell/dashboard-stats.ts");

    // The shared 24h bound lives in the outer WHERE (one window for all
    // three counts — and it keeps the query on items_created_tier_idx
    // instead of a full-table scan, 2026-07-12 perf fix).
    expect(stats).toContain(
      ".where(sql`${items.createdAt} >= ${oneDayAgoMs}`)",
    );
    expect(stats).toContain("today: sql<number>`count(*)`");
    expect(stats).toContain(
      "p1: sql<number>`count(*) filter (where ${items.tier} = 'p1')`",
    );
    expect(stats).toContain(
      "featured: sql<number>`count(*) filter (where ${items.tier} = 'featured')`",
    );
    // No per-FILTER createdAt bound — that shape allowed the three counts'
    // windows to drift apart (and forced the full-table aggregate).
    expect(stats).not.toContain(
      "filter (where ${items.createdAt} >= ${oneDayAgoMs}",
    );
  });

  it("keeps the top-bar stats type owned by the shell contract", () => {
    const topBar = readSource("components/shell/top-bar.tsx");
    const viewShell = readSource("components/shell/view-shell.tsx");

    expect(topBar).toContain("@/lib/shell/top-bar-stats");
    expect(viewShell).toContain("@/lib/shell/top-bar-stats");
    expect(topBar).not.toContain("export type TopBarStats");
  });

  it("keeps page top-bar stats mapping on the shared mapper", () => {
    const chromeData = readSource("lib/shell/chrome-data.ts");
    expect(chromeData).toContain("@/lib/shell/top-bar-stats");
    expect(chromeData).toContain("topBarStatsFromRadar(");
    expect(chromeData).toContain("signalRatioFromRadar(");

    for (const path of RADAR_FALLBACK_PAGE_PATHS) {
      const source = readSource(path);

      expect(source).not.toContain("@/lib/shell/top-bar-stats");
      expect(source).not.toContain("topBarStatsFromRadar(");
      expect(source).toContain("stats={chrome.topBarStats}");
      expect(source).not.toContain("signal_ratio: 0.72");
      expect(source).not.toMatch(
        /tracked_sources:\s*(?:stats|radarStats)\.tracked_sources/,
      );
    }
  });

  it("keeps the home signal-ratio derivation inside the shell helper", () => {
    const source = readSource("app/[locale]/page.tsx");

    expect(source).toContain(
      'getShellChromeData({ pulse: true, signalRatio: "fromRadar" })',
    );
    expect(source).not.toContain("signalRatioFromRadar(");
  });
});
