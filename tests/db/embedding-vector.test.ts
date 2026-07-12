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
