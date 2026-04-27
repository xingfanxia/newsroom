/**
 * Regression: the home page's `view=today` filter must include items
 * published since the start of yesterday — NOT only items in hot clusters.
 *
 * Without this branch, a fresh article published yesterday morning that
 * joined a cold singleton cluster (cluster.first_seen_at = yesterday, no
 * later members → cluster.latest_member_at also yesterday) is invisible
 * on the home page despite being recent + high-tier. The home then shows
 * 04-22 stories on top ("持续报道 · 1d" because they got a NEW member
 * today) while burying yesterday's actual fresh articles.
 *
 * Pure source-string test — no DB needed. Asserts the SQL query contains
 * the day-aligned rescue clause.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const liveSrc = readFileSync(
  resolve(__dirname, "../../lib/items/live.ts"),
  "utf8",
);

describe("view=today filter — fresh-but-cold rescue clause", () => {
  it("includes a day-aligned rescue clause for items published since start of yesterday", () => {
    // The clause must be `>= date_trunc('day', now() - interval '1 day')`.
    // A relative `> now() - 24h` window would drop yesterday-morning items
    // when checked yesterday-afternoon+24h = today-afternoon.
    expect(liveSrc).toMatch(
      /items\.publishedAt\}\s+>=\s+date_trunc\('day',\s+now\(\)\s+-\s+interval\s+'1 day'\)/,
    );
  });

  it("preserves the cluster-heat clauses (firstSeenAt today / latestMemberAt within hotWindow)", () => {
    expect(liveSrc).toContain("clusters.firstSeenAt} >= date_trunc('day', now())");
    expect(liveSrc).toContain("clusters.latestMemberAt} > now() - make_interval(hours =>");
  });

  it("documents WHY the day-aligned rescue is needed (so future maintainers don't revert)", () => {
    // Strip line-wrapping artifacts (newline + comment markers) so multi-line
    // phrases in block comments match cleanly.
    const flat = liveSrc.replace(/\s*\/\/\s*/g, " ").replace(/\s+/g, " ");
    expect(flat).toContain("cold singleton cluster");
    expect(flat).toContain("day-aligned");
  });
});

describe("daily-highlights mode (minImportance + maxPerDay)", () => {
  it("FeedQuery exposes minImportance and maxPerDay", () => {
    expect(liveSrc).toContain("minImportance?: number");
    expect(liveSrc).toContain("maxPerDay?: number");
  });

  it("buildFeedWhere applies minImportance to effective importance (cluster wins)", () => {
    // COALESCE(cluster.importance, item.importance) so multi-source events with
    // Stage D coverage boost can satisfy the threshold even if the lead's raw
    // score is below it.
    expect(liveSrc).toMatch(
      /COALESCE\(\$\{clusters\.importance\},\s+\$\{items\.importance\}\)\s+>=\s+\$\{q\.minImportance\}/,
    );
  });

  it("maxPerDay swaps SQL ORDER BY to day-DESC then importance-DESC", () => {
    // Default sort is publishedAt-DESC, importance-DESC tiebreaker — which
    // picks the LATEST published item per day, not the highest-importance.
    // For daily highlights we need the day's strongest events first, so the
    // primary sort changes to to_char(...,'YYYY-MM-DD') DESC.
    expect(liveSrc).toContain(
      "to_char(${items.publishedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD') DESC",
    );
  });

  it("maxPerDay TS-side cap keeps top-N rows per calendar day", () => {
    expect(liveSrc).toContain("const counts = new Map<string, number>();");
    expect(liveSrc).toContain(".publishedAt.toISOString().slice(0, 10)");
    expect(liveSrc).toContain("if (count >= cap) continue;");
  });

  it("daily-highlights only kicks in for the unfiltered home (preserves drill-ins)", () => {
    // Tab/source/date drill-ins must keep returning the full chronological
    // feed for their slice. The home page guards with:
    //   !activeDate && !sourceId && sourcePreset === 'all' && tier === 'featured'
    // so opening /zh?source=media or /zh?date=2026-04-21 stays unfiltered.
    const homeSrc = readFileSync(
      resolve(__dirname, "../../app/[locale]/page.tsx"),
      "utf8",
    );
    expect(homeSrc).toContain("dailyHighlights");
    expect(homeSrc).toMatch(
      /!activeDate\s*&&\s*!sourceId\s*&&\s*sourcePreset === "all"\s*&&\s*tier === "featured"/,
    );
    expect(homeSrc).toContain("minImportance: 80");
    expect(homeSrc).toContain("maxPerDay: 3");
  });
});

describe("recent-day rescue (recentDayRescueDays)", () => {
  // Symptom: when the operator's stage-D scoring lags ingestion, the most
  // recent days have leads but none at importance >= 80, so the daily-
  // highlights filter drops them. User sees "stuff from 3 days ago first."
  //
  // Fix: when recentDayRescueDays is set, OR-bypass minImportance for items
  // published in the last N calendar days. The maxPerDay cap still trims
  // each rescued day to top-N by importance, so noise stays bounded.
  it("FeedQuery exposes recentDayRescueDays", () => {
    expect(liveSrc).toContain("recentDayRescueDays?: number");
  });

  it("buildFeedWhere ORs in a day-aligned recent-window bypass when rescue is set", () => {
    // Day-aligned via date_trunc so the rescue covers calendar days, not a
    // rolling 24h window — same convention as the today-view rescue clause.
    expect(liveSrc).toMatch(
      /OR\s+\$\{items\.publishedAt\}\s+>=\s+date_trunc\('day',\s+now\(\)\s+-\s+make_interval\(days\s*=>/,
    );
  });

  it("home page passes recentDayRescueDays alongside daily-highlights filters", () => {
    const homeSrc = readFileSync(
      resolve(__dirname, "../../app/[locale]/page.tsx"),
      "utf8",
    );
    // 3 covers today + yesterday + 2 days ago — the typical scoring-lag
    // window. Day with weak news ingest (e.g. 04-25 max imp = 76) still
    // surfaces top-3 by importance instead of being skipped entirely.
    expect(homeSrc).toContain("recentDayRescueDays: 3");
  });
});
