import { describe, expect, it } from "bun:test";
import {
  embeddingFromDriver,
  embeddingToDriver,
  embeddingToVectorText,
} from "@/db/schema";

describe("embedding F32 blob roundtrip", () => {
  it("encodes a plain array to a little-endian F32 buffer", () => {
    const buf = embeddingToDriver([1, 2, 3]);
    expect(buf.byteLength).toBe(12);
    expect(new Float32Array(buf.buffer, buf.byteOffset, 3)).toEqual(
      new Float32Array([1, 2, 3]),
    );
  });
  it("decodes a Buffer back to numbers", () => {
    expect(embeddingFromDriver(embeddingToDriver([1, 2, 3]))).toEqual([
      1, 2, 3,
    ]);
  });
  it("decodes an ArrayBuffer (libSQL wire shape)", () => {
    const ab = new Float32Array([1, 2, 3]).buffer;
    expect(embeddingFromDriver(ab)).toEqual([1, 2, 3]);
  });
  it("respects byteOffset on pooled Buffers", () => {
    // Node Buffers can be views into a shared pool — a naive
    // `new Float32Array(value.buffer)` would read neighbors' bytes.
    const pool = Buffer.alloc(24);
    const slice = pool.subarray(8, 20);
    Buffer.from(new Float32Array([7, 8, 9]).buffer).copy(slice);
    expect(embeddingFromDriver(slice)).toEqual([7, 8, 9]);
  });
  it("empty vector roundtrips to empty array", () => {
    expect(embeddingFromDriver(embeddingToDriver([]))).toEqual([]);
  });
  it("preserves f32-representable floats through roundtrip", () => {
    const v = [0.5, -0.25, 1.5];
    expect(embeddingFromDriver(embeddingToDriver(v))).toEqual(v);
  });
});

describe("embedding vector text form (vector32 param)", () => {
  it("encodes to the JSON-array text vector32() expects", () => {
    expect(embeddingToVectorText([1, 2, 3])).toBe("[1,2,3]");
  });
  it("throws on NaN cell", () => {
    expect(() => embeddingToVectorText([1, NaN, 3])).toThrow(/non-finite/);
  });
});

describe("embedding NaN guard", () => {
  it("throws on NaN cell on encode", () => {
    expect(() => embeddingToDriver([1, NaN, 3])).toThrow(/non-finite/);
  });
  it("throws on Infinity cell on encode", () => {
    expect(() => embeddingToDriver([1, Infinity, 3])).toThrow(/non-finite/);
  });
});

describe("embeddingToSmall (Matryoshka truncation)", () => {
  it("truncates to 256 dims and L2-renormalizes", async () => {
    const { embeddingToSmall, EMBEDDING_SMALL_DIMS } = await import(
      "@/db/schema"
    );
    const full = Array.from({ length: 3072 }, (_, i) => (i < 256 ? 0.1 : 0.9));
    const small = embeddingToSmall(full);
    expect(small.length).toBe(EMBEDDING_SMALL_DIMS);
    const norm = Math.sqrt(small.reduce((a, n) => a + n * n, 0));
    expect(Math.abs(norm - 1)).toBeLessThan(1e-9);
  });
  it("preserves direction (cosine of truncated prefix)", async () => {
    const { embeddingToSmall } = await import("@/db/schema");
    const a = embeddingToSmall([3, 4, ...Array(254).fill(0), ...Array(2816).fill(9)]);
    expect(a[0]).toBeCloseTo(0.6, 9);
    expect(a[1]).toBeCloseTo(0.8, 9);
  });
  it("throws on non-finite cells inside the prefix", async () => {
    const { embeddingToSmall } = await import("@/db/schema");
    expect(() => embeddingToSmall([1, NaN, ...Array(254).fill(0)])).toThrow(
      /non-finite/,
    );
  });
});
