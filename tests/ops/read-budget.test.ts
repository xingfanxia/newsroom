import { describe, expect, it } from "bun:test";
import {
  assessReadBudget,
  parseUsageTotals,
  projectMonthlyReads,
} from "@/lib/ops/read-budget";

describe("assessReadBudget — cumulative-vs-cap guardrail", () => {
  const cap = 500_000_000; // free-plan safety cap

  it("is ok well under the warn fraction", () => {
    const v = assessReadBudget({ rows_read: 50_000_000 }, { capRows: cap });
    expect(v.status).toBe("ok");
    expect(v.alert).toBe(false);
    expect(v.fraction).toBeCloseTo(0.1, 5);
  });

  it("warns at/above the warn fraction but below the cap", () => {
    const v = assessReadBudget({ rows_read: 300_000_000 }, { capRows: cap });
    expect(v.status).toBe("warn");
    expect(v.alert).toBe(true);
  });

  it("flags over at/above the cap", () => {
    const v = assessReadBudget({ rows_read: 520_000_000 }, { capRows: cap });
    expect(v.status).toBe("over");
    expect(v.alert).toBe(true);
    expect(v.fraction).toBeGreaterThan(1);
  });

  it("honors a custom warn fraction", () => {
    const strict = assessReadBudget(
      { rows_read: 120_000_000 },
      { capRows: cap, warnFraction: 0.2 },
    );
    expect(strict.status).toBe("warn");
  });

  it("does not divide by zero on a non-positive cap", () => {
    const v = assessReadBudget({ rows_read: 10 }, { capRows: 0 });
    expect(v.fraction).toBe(0);
    expect(v.status).toBe("ok");
  });
});

describe("parseUsageTotals — fail-loud response guard", () => {
  it("parses a well-formed usage body", () => {
    const t = parseUsageTotals({ total: { rows_read: 1234, rows_written: 56 } });
    expect(t).toEqual({ rows_read: 1234, rows_written: 56 });
  });

  it("defaults rows_written to 0 when absent (informational, not a guardrail input)", () => {
    expect(parseUsageTotals({ total: { rows_read: 7 } })).toEqual({
      rows_read: 7,
      rows_written: 0,
    });
  });

  // The core guard: an API error/malformed body must THROW, never coerce to
  // rows_read:0 (which would silently grade "ok" and hide a real overage).
  it("throws when total is missing (e.g. an error body)", () => {
    expect(() => parseUsageTotals({ error: "unauthorized" })).toThrow(
      /missing\/invalid total\.rows_read/,
    );
  });

  it("throws when rows_read is missing", () => {
    expect(() => parseUsageTotals({ total: { rows_written: 5 } })).toThrow();
  });

  it("throws when rows_read is NaN / non-numeric", () => {
    expect(() => parseUsageTotals({ total: { rows_read: NaN } })).toThrow();
    expect(() => parseUsageTotals({ total: { rows_read: "1000" } })).toThrow();
  });

  it("throws on a null/undefined body rather than reading 0", () => {
    expect(() => parseUsageTotals(null)).toThrow();
    expect(() => parseUsageTotals(undefined)).toThrow();
  });
});

describe("projectMonthlyReads — run-rate × 30d", () => {
  const DAY = 86_400_000;

  it("projects a measured delta over an elapsed window to 30 days", () => {
    // 1M rows over 1 day → 30M / 30-day month.
    expect(projectMonthlyReads(1_000_000, DAY)).toBe(30_000_000);
  });

  it("scales sub-day windows correctly", () => {
    // 500k over 12h → 1M/day → 30M/month.
    expect(projectMonthlyReads(500_000, DAY / 2)).toBe(30_000_000);
  });

  it("returns 0 for a non-positive elapsed window (avoids divide-by-zero)", () => {
    expect(projectMonthlyReads(1_000, 0)).toBe(0);
  });
});
