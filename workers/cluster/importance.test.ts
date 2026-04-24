import { describe, it, expect } from "bun:test";
import {
  recomputeEventImportance,
  approximateTierForImportance,
  unionHkr,
} from "./importance";

describe("recomputeEventImportance", () => {
  it("applies log2(1+coverage)*6 boost to max member importance for singleton", () => {
    const r = recomputeEventImportance([{ importance: 60 }]);
    // coverage=1 → boost=round(log2(2)*6)=6 → 60+6=66
    expect(r.importance).toBe(66);
    expect(r.coverage).toBe(1);
    expect(r.base).toBe(60);
    expect(r.boost).toBe(6);
  });

  it("takes max member importance as base", () => {
    const r = recomputeEventImportance([
      { importance: 60 },
      { importance: 50 },
      { importance: 40 },
    ]);
    // base=60, coverage=3 → boost=round(log2(4)*6)=12 → 60+12=72
    expect(r.base).toBe(60);
    expect(r.coverage).toBe(3);
    expect(r.boost).toBe(12);
    expect(r.importance).toBe(72);
  });

  it("caps importance at 100", () => {
    const r = recomputeEventImportance(
      Array.from({ length: 32 }, () => ({ importance: 90 })),
    );
    // coverage=32 → boost=round(log2(33)*6)≈30. 90+30=120 → cap 100
    expect(r.importance).toBe(100);
  });

  it("treats null/undefined member importance as 0", () => {
    const r = recomputeEventImportance([
      { importance: null },
      { importance: 40 },
      { importance: undefined },
    ]);
    // base=40, coverage=3 → boost=12 → 52
    expect(r.base).toBe(40);
    expect(r.importance).toBe(52);
  });

  it("throws on empty array", () => {
    expect(() => recomputeEventImportance([])).toThrow(
      /at least one member/i,
    );
  });

  it("boost grows logarithmically not linearly", () => {
    const r1 = recomputeEventImportance(
      Array.from({ length: 2 }, () => ({ importance: 50 })),
    );
    const r2 = recomputeEventImportance(
      Array.from({ length: 4 }, () => ({ importance: 50 })),
    );
    const r3 = recomputeEventImportance(
      Array.from({ length: 8 }, () => ({ importance: 50 })),
    );
    // coverage 2 → boost 10, coverage 4 → boost 14, coverage 8 → boost 19
    expect(r1.boost).toBe(10);
    expect(r2.boost).toBe(14);
    expect(r3.boost).toBe(19);
    expect(r2.boost - r1.boost).toBeLessThan(r1.boost); // diminishing returns
  });
});

describe("approximateTierForImportance", () => {
  it("buckets across the full importance range", () => {
    expect(approximateTierForImportance(95)).toBe("p1");
    expect(approximateTierForImportance(85)).toBe("p1");
    expect(approximateTierForImportance(84)).toBe("featured");
    expect(approximateTierForImportance(72)).toBe("featured");
    expect(approximateTierForImportance(71)).toBe("all");
    expect(approximateTierForImportance(40)).toBe("all");
    expect(approximateTierForImportance(39)).toBe("excluded");
    expect(approximateTierForImportance(0)).toBe("excluded");
  });
});

describe("unionHkr", () => {
  it("returns true for any axis where at least one member has it true", () => {
    const r = unionHkr([
      { h: true, k: false, r: false },
      { h: false, k: true, r: false },
      { h: false, k: false, r: true },
    ]);
    expect(r).toEqual({ h: true, k: true, r: true });
  });

  it("handles null/undefined by treating as false", () => {
    const r = unionHkr([
      { h: null, k: undefined, r: true },
      { h: false },
    ]);
    expect(r).toEqual({ h: false, k: false, r: true });
  });

  it("returns all-false for empty input", () => {
    expect(unionHkr([])).toEqual({ h: false, k: false, r: false });
  });
});
