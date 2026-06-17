import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  adminLoginBodySchema,
  adminLoginInvalidResponse,
  adminLoginResponse,
  adminLoginSuccessResponse,
  adminLogoutResponse,
  sanitizeAdminNext,
} from "@/lib/api/admin-session-routes";
import { ADMIN_SESSION_COOKIE } from "@/lib/auth/password";

const ORIGINAL_PASSWORD = process.env.ADMIN_PASSWORD;

function setPassword(value: string | undefined) {
  if (value === undefined) delete process.env.ADMIN_PASSWORD;
  else process.env.ADMIN_PASSWORD = value;
}

function jsonRequest(body: string): Request {
  return new Request("https://example.test/api/admin/auth", {
    method: "POST",
    body,
    headers: { "content-type": "application/json" },
  });
}

describe("admin session route helpers", () => {
  beforeEach(() => setPassword("admin-session-route-test"));
  afterEach(() => setPassword(ORIGINAL_PASSWORD));

  test("validates login bodies", () => {
    expect(
      adminLoginBodySchema.safeParse({
        password: "secret",
        next: "/zh/admin/system",
      }).success,
    ).toBe(true);
    expect(adminLoginBodySchema.safeParse({ password: "" }).success).toBe(false);
    expect(
      adminLoginBodySchema.safeParse({ password: "x".repeat(257) }).success,
    ).toBe(false);
    expect(
      adminLoginBodySchema.safeParse({
        password: "secret",
        next: "x".repeat(2049),
      }).success,
    ).toBe(false);
  });

  test("sanitizes next targets to local non-API paths", () => {
    expect(sanitizeAdminNext(undefined)).toBe("/");
    expect(sanitizeAdminNext("/zh/admin/system")).toBe("/zh/admin/system");
    expect(sanitizeAdminNext("https://evil.example/admin")).toBe("/");
    expect(sanitizeAdminNext("//evil.example/admin")).toBe("/");
    expect(sanitizeAdminNext("/api/admin/logout")).toBe("/");
  });

  test("invalid login response keeps the ok-envelope error shape", async () => {
    const res = adminLoginInvalidResponse();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "invalid" });
  });

  test("login request helper validates JSON and rejects malformed bodies", async () => {
    const res = await adminLoginResponse(jsonRequest("{"));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      ok: false,
      error: "invalid_json",
    });
  });

  test("login request helper rejects wrong passwords", async () => {
    const res = await adminLoginResponse(
      jsonRequest(JSON.stringify({ password: "wrong" })),
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "invalid" });
  });

  test("login request helper accepts valid passwords and sanitizes next", async () => {
    const res = await adminLoginResponse(
      jsonRequest(
        JSON.stringify({
          password: "admin-session-route-test",
          next: "/api/admin/system",
        }),
      ),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      next: "/",
    });
    expect(res.headers.get("set-cookie") ?? "").toContain(
      `${ADMIN_SESSION_COOKIE}=`,
    );
  });

  test("successful login response sets a fresh admin session cookie", async () => {
    const res = adminLoginSuccessResponse("/zh/admin/system");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      next: "/zh/admin/system",
    });
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${ADMIN_SESSION_COOKIE}=`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=lax");
  });

  test("logout response clears the admin session cookie", async () => {
    const res = adminLogoutResponse();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${ADMIN_SESSION_COOKIE}=`);
    expect(setCookie).toContain("Max-Age=0");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=lax");
  });
});
