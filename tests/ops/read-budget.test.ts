import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assessReadBudget,
  parseUsageTotals,
  projectMonthlyReads,
} from "@/lib/ops/read-budget";
import {
  isReading,
  loadHistory,
  RETENTION_DAYS,
} from "@/scripts/ops/read-budget";

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

describe("isReading — snapshot entry guard", () => {
  it("accepts a well-formed reading", () => {
    expect(isReading({ rows_read: 5, captured_at: "2026-07-13T00:00:00Z" })).toBe(
      true,
    );
  });

  it("rejects missing/invalid fields", () => {
    expect(isReading({ rows_read: 5 })).toBe(false);
    expect(isReading({ rows_read: "5", captured_at: "2026-07-13T00:00:00Z" })).toBe(
      false,
    );
    expect(isReading({ rows_read: 5, captured_at: "not-a-date" })).toBe(false);
    expect(isReading(null)).toBe(false);
  });
});

describe("loadHistory — rolling snapshot state", () => {
  const NOW = Date.parse("2026-07-13T12:00:00Z");
  const DAY = 86_400_000;
  const iso = (ms: number) => new Date(ms).toISOString();
  let dir: string | undefined;

  afterEach(() => {
    delete process.env.SNAPSHOT_IN;
    delete process.env.PREV_ROWS;
    delete process.env.PREV_AT;
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function writeSnapshot(content: string): string {
    dir = mkdtempSync(join(tmpdir(), "rb-"));
    const path = join(dir, "snap.json");
    writeFileSync(path, content);
    process.env.SNAPSHOT_IN = path;
    return path;
  }

  it("first run (no file, no env) → empty history, not corrupt", () => {
    const r = loadHistory(NOW);
    expect(r.history).toEqual([]);
    expect(r.corrupt).toBe(false);
  });

  it("reads a valid array, sorted oldest-first", () => {
    writeSnapshot(
      JSON.stringify([
        { rows_read: 200, captured_at: iso(NOW - 1 * DAY) },
        { rows_read: 100, captured_at: iso(NOW - 2 * DAY) },
      ]),
    );
    const r = loadHistory(NOW);
    expect(r.corrupt).toBe(false);
    expect(r.history.map((h) => h.rows_read)).toEqual([100, 200]);
  });

  it("prunes readings older than the retention window", () => {
    writeSnapshot(
      JSON.stringify([
        { rows_read: 10, captured_at: iso(NOW - (RETENTION_DAYS + 2) * DAY) },
        { rows_read: 20, captured_at: iso(NOW - 1 * DAY) },
      ]),
    );
    const r = loadHistory(NOW);
    expect(r.history.map((h) => h.rows_read)).toEqual([20]);
  });

  it("accepts a legacy single-object snapshot as a one-entry history", () => {
    writeSnapshot(JSON.stringify({ rows_read: 42, captured_at: iso(NOW - DAY) }));
    const r = loadHistory(NOW);
    expect(r.corrupt).toBe(false);
    expect(r.history).toEqual([{ rows_read: 42, captured_at: iso(NOW - DAY) }]);
  });

  // The fail-loud contract: a corrupt baseline is NOT the same as "no baseline".
  it("flags corrupt=true on unparseable JSON (guardrail was blind)", () => {
    writeSnapshot("{not json");
    const r = loadHistory(NOW);
    expect(r.corrupt).toBe(true);
    expect(r.history).toEqual([]);
  });

  it("flags corrupt=true when a file has zero valid readings", () => {
    writeSnapshot(JSON.stringify([{ nope: 1 }]));
    const r = loadHistory(NOW);
    expect(r.corrupt).toBe(true);
  });

  it("falls back to PREV_ROWS/PREV_AT env when no file", () => {
    process.env.PREV_ROWS = "555";
    process.env.PREV_AT = iso(NOW - DAY);
    const r = loadHistory(NOW);
    expect(r.corrupt).toBe(false);
    expect(r.history).toEqual([{ rows_read: 555, captured_at: iso(NOW - DAY) }]);
  });
});
