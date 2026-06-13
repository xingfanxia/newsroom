import { describe, expect, test } from "bun:test";
import { okEmpty, okError, okJson } from "@/lib/api/ok-response";

describe("ok response envelopes", () => {
  test("okJson returns a shared success envelope", async () => {
    const res = okJson({ value: 1 });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ ok: true, value: 1 });
  });

  test("okEmpty returns the minimal success envelope", async () => {
    const res = okEmpty();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("okError returns the shared error envelope with extra fields", async () => {
    const res = okError("not_found", 404, { id: 123 });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      ok: false,
      id: 123,
      error: "not_found",
    });
  });
});
