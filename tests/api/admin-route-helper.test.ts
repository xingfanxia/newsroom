import { describe, expect, test } from "bun:test";
import {
  adminError,
  adminJson,
  adminOk,
  adminRouteResult,
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

  test("adminRouteResult maps domain results to the shared admin envelope", async () => {
    const ok = adminRouteResult(
      { ok: true, payload: { value: 1 } },
      adminJson,
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, value: 1 });

    const empty = adminRouteResult({ ok: true }, () => adminOk());
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ ok: true });

    const err = adminRouteResult(
      {
        ok: false,
        error: "not_found",
        status: 404,
        extra: { id: 123 },
      },
      adminJson,
    );
    expect(err.status).toBe(404);
    expect(await err.json()).toEqual({
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
