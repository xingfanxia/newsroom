/**
 * Regression: the calendar grid (getDayCounts) and the per-page feed
 * (getFeaturedStories) must apply the SAME source-tag / curated / tier
 * filters. Otherwise a calendar cell can over-promise — e.g., the home
 * feed and calendar filters must stay paired; otherwise users click a
 * non-zero calendar cell and see an empty feed.
 *
 * Pure source-string test — asserts the SQL composes the expected filter
 * expressions and each page wires its filters into the calendar call.
 */
import { describe, expect, it } from "bun:test";
import { readSource } from "@/tests/helpers/source";

const statsSrc = readSource("lib/shell/dashboard-stats.ts");

describe("getDayCounts — filter contract with feed", () => {
  it("accepts a filter-options arg with tier / source-tag / curated", () => {
    // Signature: getDayCounts(days, opts?). The `opts` shape mirrors the
    // FeedQuery subset that affects which lead items show up in the feed
    // for a given calendar cell.
    expect(statsSrc).toMatch(/getDayCounts\([^)]*opts\??:\s*\{/);
    expect(statsSrc).toContain("excludeSourceTags?: string[]");
    expect(statsSrc).toContain("includeSourceTags?: string[]");
    expect(statsSrc).toContain("curatedOnly?: boolean");
    expect(statsSrc).toContain("tier?:");
  });

  it("joins sources when filters are present (not when called without opts)", () => {
    // The base /all-tier-no-tags call shouldn't pay the JOIN cost; only when
    // a filter actually narrows the count do we add the join.
    expect(statsSrc).toMatch(/JOIN\s+sources\s+s/i);
  });

  it("composes excludeSourceTags via NOT EXISTS json_each(s.tags)", () => {
    // s.tags is a JSON-text array — overlap goes through json_each, same
    // shape as buildFeedWhere's excludeTagsFilter.
    expect(statsSrc).toMatch(/AND NOT EXISTS \(\s*SELECT 1 FROM json_each\(s\.tags\)/);
  });

  it("composes includeSourceTags via EXISTS json_each(s.tags)", () => {
    expect(statsSrc).toMatch(/AND EXISTS \(\s*SELECT 1 FROM json_each\(s\.tags\)/);
  });

  it("composes curatedOnly via s.curated = TRUE", () => {
    expect(statsSrc).toMatch(/s\.curated\s*=\s*TRUE/i);
  });

  it("composes the featured tier filter through the shared highlight-tier SQL helper", () => {
    // tier='featured' stays inclusive; the tuple itself lives in lib/types.ts.
    expect(statsSrc).toContain("highlightTierInSql");
    expect(statsSrc).toContain("coalesce(c.event_tier, i.tier)");
    expect(statsSrc).not.toMatch(/IN\s*\(\s*'featured'\s*,\s*'p1'\s*\)/i);
  });

  it("W9b: pins items_feed_recent_idx so the always-present 60-day bound SEEKs", () => {
    // getDayCounts ALWAYS filters published_at >= floor, so it must pin the
    // published_at-LEADING index (seek the window) not items_feed_cover_idx
    // (published_at last → scans the whole enriched corpus). See feedIndexFor.
    expect(statsSrc).toContain(
      "FROM items i INDEXED BY items_feed_recent_idx",
    );
    expect(statsSrc).not.toContain("FROM items i INDEXED BY items_feed_cover_idx");
  });
});

describe("dashboard stats display helpers", () => {
  it("keeps policy summary relative-time formatting in the shared helper", () => {
    expect(statsSrc).toContain("@/lib/time/relative");
    expect(statsSrc).toContain("formatCoarseRelativeTime");
    expect(statsSrc).not.toContain("const ageMs");
    expect(statsSrc).not.toContain("const ageH");
    expect(statsSrc).not.toContain("const ageD");
  });
});

describe("page calendars pass the same filters as their feed", () => {
  const homeSrc = readSource("app/[locale]/page.tsx");
  const curatedSrc = readSource("app/[locale]/curated/page.tsx");

  // [\s\S]*? is the cross-target-compatible substitute for `.` with the `s`
  // (dotAll) flag — the project targets ES2017 and `s` is ES2018+. Lazy
  // quantifier so the match doesn't stretch past the closing brace.
  // Pages call the W8b cached wrapper (getDayCountsCached) — the filter contract
  // is identical; only the read is deduped across renders (lib/shell/feed-cache).
  it("home /zh — getDayCountsCached passes the default home highlight tier", () => {
    expect(homeSrc).toContain("DEFAULT_HOME_TIER");
    expect(homeSrc).toMatch(
      /getDayCountsCached\(\s*60\s*,\s*\{[\s\S]*?tier:\s*DEFAULT_HOME_TIER[\s\S]*?\}/,
    );
  });

  it("curated /zh/curated — getDayCountsCached passes curatedOnly=true", () => {
    expect(curatedSrc).toMatch(
      /getDayCountsCached\(\s*60\s*,\s*\{[\s\S]*?curatedOnly:\s*true[\s\S]*?\}/,
    );
  });
});
