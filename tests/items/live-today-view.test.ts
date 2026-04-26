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
