import { describe, expect, test } from "bun:test";
import { sessionAuthRequiredResponse } from "@/lib/api/session-auth";

describe("sessionAuthRequiredResponse", () => {
  test("maps missing cookie auth to the shared JSON envelope", async () => {
    const res = sessionAuthRequiredResponse();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      ok: false,
      error: "auth_required",
    });
  });
});
