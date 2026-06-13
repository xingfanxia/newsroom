import { describe, expect, test } from "bun:test";
import {
  runSessionRoute,
  sessionError,
  sessionJson,
  sessionOk,
} from "@/lib/api/session-route";

describe("session route helpers", () => {
  test("sessionJson returns the shared ok envelope", async () => {
    const res = sessionJson({ value: 1 });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ ok: true, value: 1 });
  });

  test("sessionOk returns an empty ok envelope", async () => {
    const res = sessionOk();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("sessionError returns the shared error envelope", async () => {
    const res = sessionError("not_found", 404);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: "not_found" });
  });

  test("runSessionRoute returns auth denial without running the handler", async () => {
    let ran = false;
    const res = await runSessionRoute(async () => {
      ran = true;
      return sessionOk();
    });

    expect(ran).toBe(false);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      ok: false,
      error: "auth_required",
    });
  });
});
