import { describe, expect, test } from "bun:test";
import { adminAuthErrorResponse } from "@/lib/api/admin-auth";
import { ForbiddenError, UnauthorizedError } from "@/lib/auth/session";

async function json(res: Response) {
  return res.json() as Promise<unknown>;
}

describe("adminAuthErrorResponse", () => {
  test("maps missing auth to the admin JSON envelope", async () => {
    const res = adminAuthErrorResponse(new UnauthorizedError());

    expect(res?.status).toBe(401);
    expect(await json(res!)).toEqual({
      ok: false,
      error: "auth_required",
    });
  });

  test("maps forbidden auth to the admin JSON envelope", async () => {
    const res = adminAuthErrorResponse(new ForbiddenError());

    expect(res?.status).toBe(403);
    expect(await json(res!)).toEqual({
      ok: false,
      error: "admin_required",
    });
  });

  test("returns null for unrelated errors so routes can rethrow them", () => {
    expect(adminAuthErrorResponse(new Error("db failed"))).toBeNull();
  });
});
