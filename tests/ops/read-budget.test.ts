import { describe, expect, it } from "bun:test";
import {
  assessReadBudget,
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
