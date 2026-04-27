/**
 * Regression: the calendar grid (getDayCounts) and the per-page feed
 * (getFeaturedStories) must apply the SAME source-tag / curated / tier
 * filters. Otherwise a calendar cell can over-promise — e.g., the home
 * page on 2026-04-27 showed `27 (6)` because all 6 lead items were arxiv
 * papers, but the home feed excludes arxiv → user clicks the cell and
 * sees an empty feed.
 *
 * Pure source-string test — asserts the SQL composes the expected filter
 * expressions and each page wires its filters into the calendar call.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const statsSrc = readFileSync(
  resolve(__dirname, "../../lib/shell/dashboard-stats.ts"),
  "utf8",
);

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

  it("composes excludeSourceTags via NOT (s.tags && ARRAY[...]::text[])", () => {
    // Drizzle binds JS arrays as tuples ($1,$2) which the planner rejects
    // for `&&`. Build the array via sql.join — same shape as
    // buildFeedWhere's excludeTagsFilter.
    expect(statsSrc).toMatch(/NOT\s*\(\s*s\.tags\s*&&\s*ARRAY\[/);
  });

  it("composes includeSourceTags via s.tags && ARRAY[...]::text[]", () => {
    expect(statsSrc).toMatch(/s\.tags\s*&&\s*ARRAY\[/);
  });

  it("composes curatedOnly via s.curated = TRUE", () => {
    expect(statsSrc).toMatch(/s\.curated\s*=\s*TRUE/i);
  });

  it("composes tier filter via coalesce(c.event_tier, i.tier) IN (...)", () => {
    // tier='featured' → IN ('featured','p1'); 'p1' → = 'p1'; 'all' → <> 'excluded' (existing).
    expect(statsSrc).toMatch(
      /coalesce\(c\.event_tier,\s*i\.tier[^)]*\)\s+IN\s*\(\s*'featured'\s*,\s*'p1'\s*\)/i,
    );
  });
});

describe("page calendars pass the same filters as their feed", () => {
  const homeSrc = readFileSync(
    resolve(__dirname, "../../app/[locale]/page.tsx"),
    "utf8",
  );
  const papersSrc = readFileSync(
    resolve(__dirname, "../../app/[locale]/papers/page.tsx"),
    "utf8",
  );
  const curatedSrc = readFileSync(
    resolve(__dirname, "../../app/[locale]/curated/page.tsx"),
    "utf8",
  );

  // [\s\S]*? is the cross-target-compatible substitute for `.` with the `s`
  // (dotAll) flag — the project targets ES2017 and `s` is ES2018+. Lazy
  // quantifier so the match doesn't stretch past the closing brace.
  it("home /zh — getDayCounts passes excludeSourceTags=['arxiv','paper'] and tier='featured'", () => {
    expect(homeSrc).toMatch(
      /getDayCounts\(\s*60\s*,\s*\{[\s\S]*?excludeSourceTags:\s*\[\s*"arxiv"\s*,\s*"paper"\s*\][\s\S]*?\}/,
    );
    expect(homeSrc).toMatch(
      /getDayCounts\(\s*60\s*,\s*\{[\s\S]*?tier:\s*"featured"[\s\S]*?\}/,
    );
  });

  it("papers /zh/papers — getDayCounts passes includeSourceTags=PAPER_TAGS", () => {
    expect(papersSrc).toMatch(
      /getDayCounts\(\s*60\s*,\s*\{[\s\S]*?includeSourceTags:\s*PAPER_TAGS[\s\S]*?\}/,
    );
  });

  it("curated /zh/curated — getDayCounts passes curatedOnly=true", () => {
    expect(curatedSrc).toMatch(
      /getDayCounts\(\s*60\s*,\s*\{[\s\S]*?curatedOnly:\s*true[\s\S]*?\}/,
    );
  });
});
