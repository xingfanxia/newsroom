import { describe, expect, test } from "bun:test";
import { parseIterationRunRouteId } from "@/lib/policy/iterations";

describe("parseIterationRunRouteId", () => {
  test("accepts positive integer route ids", () => {
    expect(parseIterationRunRouteId("42")).toEqual({ ok: true, id: 42 });
    expect(parseIterationRunRouteId("001")).toEqual({ ok: true, id: 1 });
  });

  test("rejects invalid route ids", () => {
    expect(parseIterationRunRouteId("0")).toEqual({
      ok: false,
      error: "invalid_id",
    });
    expect(parseIterationRunRouteId("-1")).toEqual({
      ok: false,
      error: "invalid_id",
    });
    expect(parseIterationRunRouteId("abc")).toEqual({
      ok: false,
      error: "invalid_id",
    });
  });
});
