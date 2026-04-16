import { describe, expect, it } from "bun:test";
import { halfvecFromDriver, halfvecToDriver } from "@/db/schema";

describe("halfvec roundtrip", () => {
  it("encodes a plain array to pgvector text format", () => {
    expect(halfvecToDriver([1, 2, 3])).toBe("[1,2,3]");
  });
  it("decodes pgvector text format to numbers", () => {
    expect(halfvecFromDriver("[1,2,3]")).toEqual([1, 2, 3]);
  });
  it("decodes tolerates no-bracket form", () => {
    expect(halfvecFromDriver("1,2,3")).toEqual([1, 2, 3]);
  });
  it("empty vector decodes to empty array", () => {
    expect(halfvecFromDriver("[]")).toEqual([]);
  });
  it("preserves floats through roundtrip", () => {
    const v = [0.0123, -0.987, 1.5e-10];
    expect(halfvecFromDriver(halfvecToDriver(v))).toEqual(v);
  });
});

describe("halfvec NaN guard", () => {
  it("throws on NaN cell on encode", () => {
    expect(() => halfvecToDriver([1, NaN, 3])).toThrow(/non-finite/);
  });
  it("throws on Infinity cell on encode", () => {
    expect(() => halfvecToDriver([1, Infinity, 3])).toThrow(/non-finite/);
  });
  it("throws on malformed cell on decode", () => {
    expect(() => halfvecFromDriver("[1,,3]")).toThrow(/non-finite/);
  });
  it("throws on trailing comma on decode", () => {
    expect(() => halfvecFromDriver("[1,2,]")).toThrow(/non-finite/);
  });
  it("throws on non-numeric cell on decode", () => {
    expect(() => halfvecFromDriver("[1,abc,3]")).toThrow(/non-finite/);
  });
});
