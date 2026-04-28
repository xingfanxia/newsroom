/**
 * Regression: stories grouped by `groupByDay` rendered under wrong day
 * headers because the canonical key was a UTC-midnight Date that the
 * client (PDT) re-parsed as the previous day's evening. Items at
 * 2026-04-24T03:07Z piled up under a header labeled "2026-04-23 · Thu"
 * because new Date("2026-04-24T00:00:00.000Z") in PDT = 2026-04-23 17:00.
 *
 * Fix: the day key is now a stable "YYYY-MM-DD" UTC string, and DayBreak
 * formats from those components via getUTC*. Server and client agree.
 *
 * Pure source-string + behavior tests.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { groupByDay } from "@/lib/feed/group-by-day";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

describe("groupByDay (shared) — keys are UTC-day YYYY-MM-DD strings", () => {
  it("buckets items by their UTC calendar day", () => {
    const stories = [
      { publishedAt: "2026-04-24T03:07:00.000Z" }, // UTC 04-24
      { publishedAt: "2026-04-24T20:00:00.000Z" }, // UTC 04-24
      { publishedAt: "2026-04-23T18:06:00.000Z" }, // UTC 04-23
    ];
    const grouped = groupByDay(stories);
    const days = Object.keys(grouped).sort().reverse();
    expect(days).toEqual(["2026-04-24", "2026-04-23"]);
    expect(grouped["2026-04-24"]).toHaveLength(2);
    expect(grouped["2026-04-23"]).toHaveLength(1);
  });

  it("preserves the SQL order within each bucket (no resorting)", () => {
    const stories = [
      { publishedAt: "2026-04-24T20:00:00.000Z", id: "a" },
      { publishedAt: "2026-04-24T03:07:00.000Z", id: "b" },
      { publishedAt: "2026-04-24T03:15:00.000Z", id: "c" },
    ];
    const grouped = groupByDay(stories);
    expect(grouped["2026-04-24"].map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("buckets are TZ-stable — same key regardless of process TZ", () => {
    // Day boundary case: 04-24T03:07Z is 04-23 evening in PDT but still
    // 04-24 in UTC. Key must be 04-24 either way (server is UTC, client
    // could be anywhere).
    const story = { publishedAt: "2026-04-24T03:07:00.000Z" };
    const grouped = groupByDay([story]);
    expect(Object.keys(grouped)).toEqual(["2026-04-24"]);
  });
});

describe("DayBreak — accepts dayKey string and formats via UTC", () => {
  const dayBreakSrc = readFileSync(
    resolve(root, "app/[locale]/_day-break.tsx"),
    "utf8",
  );

  it("accepts a dayKey: string prop (YYYY-MM-DD)", () => {
    expect(dayBreakSrc).toMatch(/dayKey\s*:\s*string/);
  });

  it("does NOT use local-tz date getters (getMonth/getDate/getDay)", () => {
    // Local-TZ getters drift the visible day relative to the UTC key.
    // All components MUST come from getUTC*.
    expect(dayBreakSrc).not.toMatch(/\.getMonth\(\)/);
    expect(dayBreakSrc).not.toMatch(/\.getDate\(\)/);
    expect(dayBreakSrc).not.toMatch(/\.getDay\(\)/);
    expect(dayBreakSrc).not.toMatch(/\.getFullYear\(\)/);
  });

  it("uses UTC-day weekday (getUTCDay) so weekday matches the UTC key", () => {
    expect(dayBreakSrc).toContain("getUTCDay");
  });
});

describe("page.tsx callers pass dayKey strings (not Date objects)", () => {
  const pages = [
    "app/[locale]/page.tsx",
    "app/[locale]/all/page.tsx",
    "app/[locale]/papers/page.tsx",
    "app/[locale]/curated/page.tsx",
    "app/[locale]/podcasts/page.tsx",
    "app/[locale]/x-monitor/page.tsx",
    "app/[locale]/saved/page.tsx",
  ];

  for (const p of pages) {
    it(`${p} — passes dayKey string, not new Date(dayKey)`, () => {
      const src = readFileSync(resolve(root, p), "utf8");
      // Old buggy form: <DayBreak date={new Date(dayKey)} />
      expect(src).not.toMatch(/<DayBreak\s+date=\{new Date\(dayKey\)\}/);
      // New form: <DayBreak dayKey={dayKey} />
      expect(src).toMatch(/<DayBreak\s+dayKey=\{[^}]+\}/);
    });
  }

  it("page.tsx imports the shared groupByDay from lib/feed", () => {
    const src = readFileSync(resolve(root, "app/[locale]/page.tsx"), "utf8");
    expect(src).toMatch(/from\s+["']@\/lib\/feed\/group-by-day["']/);
  });
});
