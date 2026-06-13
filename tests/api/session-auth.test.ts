import { describe, expect, test } from "bun:test";
import {
  requireSessionForRoute,
  sessionAuthRequiredResponse,
} from "@/lib/api/session-auth";
import { getSessionUser } from "@/lib/auth/session";

describe("sessionAuthRequiredResponse", () => {
  test("maps missing cookie auth to the shared JSON envelope", async () => {
    const res = sessionAuthRequiredResponse();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      ok: false,
      error: "auth_required",
    });
  });

  test("treats missing request scope as unauthenticated", async () => {
    const user = await getSessionUser();
    const auth = await requireSessionForRoute();

    expect(user).toBeNull();
    expect(auth.ok).toBe(false);
    if (!auth.ok) {
      expect(auth.response.status).toBe(401);
      expect(await auth.response.json()).toEqual({
        ok: false,
        error: "auth_required",
      });
    }
  });
});
