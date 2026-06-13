import { describe, expect, test } from "bun:test";
import {
  adminError,
  adminJson,
  adminOk,
  adminServerError,
  runAdminRoute,
} from "@/lib/api/admin-route";

describe("admin route helpers", () => {
  test("adminJson returns the shared ok envelope", async () => {
    const res = adminJson({ value: 1 });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ ok: true, value: 1 });
  });

  test("adminOk returns an empty ok envelope", async () => {
    const res = adminOk();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("adminError returns the shared error envelope", async () => {
    const res = adminError("not_found", 404, { id: 123 });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      ok: false,
      id: 123,
      error: "not_found",
    });
  });

  test("adminServerError logs the route label and returns the shared 500 envelope", async () => {
    const originalError = console.error;
    const calls: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      calls.push(args);
    };

    try {
      const err = new Error("boom");
      const res = adminServerError("api/admin/example", err, {
        detail: "kept",
      });

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        ok: false,
        detail: "kept",
        error: "server_error",
      });
      expect(calls).toEqual([["[api/admin/example] failed", err]]);
    } finally {
      console.error = originalError;
    }
  });

  test("runAdminRoute returns auth denial without running the handler", async () => {
    let ran = false;
    const res = await runAdminRoute(async () => {
      ran = true;
      return adminOk();
    });

    expect(ran).toBe(false);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      ok: false,
      error: "auth_required",
    });
  });
});
