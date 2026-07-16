/**
 * W8 — the public feed views bound their scan to a recency window so the query
 * SEEKs items_feed_recent_idx (published_at leads) instead of scanning every
 * enriched row (~21.6k rows/render → a few k). This suite guards the read-budget
 * bound at three levels, weakest-to-strongest inverted (the behavioral level is
 * the load-bearing one):
 *
 *   1. feedIndexFor() — pure fn, invoked directly: pins the recent index exactly
 *      when a published_at lower bound (recencyFloorDays OR an explicit date) is
 *      present, and the cover index otherwise.
 *   2. buildFeedWhere() — BEHAVIORAL (the load-bearing guard): compile the drizzle
 *      WHERE to SQL + params and assert the `published_at >= <floor>` predicate is
 *      PRESENT for a floored query and ABSENT for an unbounded / date-bound one.
 *      Dropping `recencyFloorFilter` from the and(...) — the exact regression that
 *      silently reverts the read-budget win — makes the floor param vanish and
 *      trips these tests (a source-string guard could not catch that).
 *   3. Wiring tripwires — lightweight source checks that the page-model builders
 *      (which the server components delegate to) pass the floor and that
 *      schema/optimizer declare the published_at-leading index + seek-shape plan
 *      check. Builder composition and migration DDL aren't unit-executable here,
 *      so these catch accidental deletion of the wiring; they are explicitly NOT
 *      the behavioral guard (that's level 2) — only a cheap tripwire for the
 *      non-executable surfaces.
 */
import { describe, expect, it } from "bun:test";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { buildFeedWhere, feedIndexFor } from "@/lib/items/live";
import { exportedFunctionSection, readSource } from "@/tests/helpers/source";

const dialect = new SQLiteSyncDialect();

/**
 * Compile buildFeedWhere to parameterized SQL. `and(...)` types as SQL|undefined
 * (undefined iff every conjunct is undefined) — every feed query filters at least
 * enriched_at IS NOT NULL, so undefined here is a real bug; fail loud, don't
 * paper over it with a non-null assert.
 */
function compileWhere(q: Parameters<typeof buildFeedWhere>[0]) {
  const where = buildFeedWhere(q);
  if (!where) {
    throw new Error("buildFeedWhere returned an empty WHERE — feed query lost all filters");
  }
  return dialect.sqlToQuery(where);
}

/**
 * Report whether the compiled feed WHERE carries a `published_at >= floor` bound
 * for the given day count. The floor value is Date.now()-N*day computed inside
 * buildFeedWhere; we recompute the target at assert time and match within a
 * generous 120s tolerance (absorbs the ms between build+assert). The tolerance
 * is far tighter than the ≥5-day gap to any today-view timestamp param, so a
 * today-view rescue bound never false-matches a recency floor.
 */
function floorParamPresent(
  q: Parameters<typeof buildFeedWhere>[0],
  days: number,
): boolean {
  const { params } = compileWhere(q);
  const target = Date.now() - days * 86_400_000;
  return params.some(
    (p) => typeof p === "number" && Math.abs(p - target) < 120_000,
  );
}

describe("feedIndexFor — pins the recency index only when published_at is bounded", () => {
  it("uses the cover index for an unbounded query", () => {
    expect(feedIndexFor({})).toBe("items_feed_cover_idx");
  });

  it("uses the recency index when a recency floor is set", () => {
    expect(feedIndexFor({ recencyFloorDays: 7 })).toBe("items_feed_recent_idx");
    expect(feedIndexFor({ recencyFloorDays: 30 })).toBe("items_feed_recent_idx");
  });

  it("treats a non-positive floor as no bound (cover index)", () => {
    expect(feedIndexFor({ recencyFloorDays: 0 })).toBe("items_feed_cover_idx");
  });

  it("uses the recency index for an explicit date / date-window (seekable bound)", () => {
    expect(feedIndexFor({ date: "2026-07-13" })).toBe("items_feed_recent_idx");
    expect(feedIndexFor({ dateFrom: "2026-07-01" })).toBe("items_feed_recent_idx");
    expect(feedIndexFor({ dateTo: "2026-07-13" })).toBe("items_feed_recent_idx");
  });

  it("keeps the cover index for source / search filters (no published_at bound)", () => {
    expect(feedIndexFor({ sourceId: "openai-blog" })).toBe("items_feed_cover_idx");
    expect(feedIndexFor({ sourceGroup: "podcast" })).toBe("items_feed_cover_idx");
    expect(feedIndexFor({ searchText: "gpt" })).toBe("items_feed_cover_idx");
  });
});

describe("buildFeedWhere — the recency floor predicate compiles in/out per query shape", () => {
  it("emits `published_at >= now-7d` for a 7d floor (today AND archive views)", () => {
    expect(floorParamPresent({ recencyFloorDays: 7, view: "today" }, 7)).toBe(true);
    expect(floorParamPresent({ recencyFloorDays: 7, view: "archive" }, 7)).toBe(true);
  });

  it("emits `published_at >= now-30d` for a 30d floor", () => {
    expect(floorParamPresent({ recencyFloorDays: 30, view: "archive" }, 30)).toBe(true);
  });

  it("emits NO floor predicate for an unbounded query (today or archive)", () => {
    expect(floorParamPresent({ view: "archive" }, 7)).toBe(false);
    expect(floorParamPresent({ view: "today" }, 7)).toBe(false);
  });

  it("emits NO numeric bound for a non-positive floor on the archive view", () => {
    // archive + no date + floor<=0 → every filter is TRUE-or-string; a leaked
    // floor would be the only numeric param, so its absence proves floor:0 = off.
    const { params } = compileWhere({ recencyFloorDays: 0, view: "archive" });
    expect(params.some((p) => typeof p === "number")).toBe(false);
  });

  it("bypasses the floor when an explicit date is set (calendar reaches any day)", () => {
    // date present → floor stands down so drilling into an old day is never
    // truncated to empty. Both single-day and date-range bounds neutralize it.
    expect(floorParamPresent({ recencyFloorDays: 7, date: "2026-01-01" }, 7)).toBe(false);
    expect(floorParamPresent({ recencyFloorDays: 7, dateFrom: "2026-01-01" }, 7)).toBe(false);
  });
});

describe("count + fetch pin the SAME feed index (no pagination-total drift)", () => {
  // Both getFeaturedStories and countFeaturedStories derive their pinned index
  // from feedIndexFor(q) on the same query object, so the paginated total can't
  // diverge from the returned rows. feedIndexFor's behavior is unit-tested above;
  // this tripwire catches either call site dropping the shared derivation.
  const src = readSource("lib/items/live.ts");

  it("getFeaturedStories pins its id-subquery via feedIndexFor", () => {
    expect(src).toMatch(/const feedIndex = feedIndexFor\(q\)/);
    expect(src).toContain("INDEXED BY ${sql.raw(feedIndex)}");
  });

  it("countFeaturedStories pins its FROM via feedIndexFor", () => {
    expect(src).toContain("INDEXED BY ${sql.raw(feedIndexFor(q))}");
  });
});

describe("page-model builders pass the W8 recency floor (wiring tripwire)", () => {
  // The floor is derived and wired into queryPublicFeed inside each page's
  // model builder now; the server components just coerce params and delegate.
  const buildersSrc = readSource("lib/public-content/page-model-builders.ts");
  const homeBuilder = exportedFunctionSection(
    buildersSrc,
    "buildPublicHomePageModelFromSnapshot",
  );
  const allBuilder = exportedFunctionSection(buildersSrc, "buildAllPageModel");
  const curatedBuilder = exportedFunctionSection(
    buildersSrc,
    "buildCuratedPageModel",
  );

  it("home: 7d today / 30d daily-highlights, skipped for source views", () => {
    expect(homeBuilder).toContain("recencyFloorDays");
    expect(homeBuilder).toMatch(/dailyHighlights\s*\?\s*30\s*:\s*7/);
    expect(homeBuilder).toContain('input.sourceId || input.sourcePreset !== "all"');
  });

  it("all + curated: 30d default, skipped when a source filter is active", () => {
    expect(allBuilder).toMatch(/recencyFloorDays:\s*[\s\S]*?30/);
    expect(curatedBuilder).toMatch(
      /recencyFloorDays:\s*input\.sourceId\s*\?\s*undefined\s*:\s*30/,
    );
  });
});

describe("items_feed_recent_idx declared with published_at leading (schema + optimizer)", () => {
  it("schema declares the published_at-leading covering index", () => {
    const schemaSrc = readSource("db/schema.ts");
    expect(schemaSrc).toContain('index("items_feed_recent_idx")');
    // published_at MUST lead for the >= floor predicate to seek.
    expect(schemaSrc).toMatch(
      /index\("items_feed_recent_idx"\)\.on\(\s*t\.publishedAt/,
    );
  });

  it("db-optimize creates the index and plan-checks the SEEK shape (not just the name)", () => {
    const optSrc = readSource("scripts/ops/db-optimize.ts");
    expect(optSrc).toContain("CREATE INDEX IF NOT EXISTS items_feed_recent_idx");
    expect(optSrc).toMatch(/ON items \(published_at,/);
    // Strengthened check: asserts the (published_at>?) seek, so a column-order
    // regression that degrades the plan to a full scan trips the plan check.
    expect(optSrc).toContain("items_feed_recent_idx (published_at>?)");
  });
});
