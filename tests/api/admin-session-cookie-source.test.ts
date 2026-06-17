import { describe, expect, test } from "bun:test";
import { readSource as read } from "@/tests/helpers/source";

describe("admin session cookie source wiring", () => {
  test("login and logout routes share admin session response helpers", () => {
    const login = read("app/api/admin/auth/route.ts");
    const logout = read("app/api/admin/logout/route.ts");
    const helper = read("lib/api/admin-session-routes.ts");

    expect(login).toContain("@/lib/api/admin-session-routes");
    expect(logout).toContain("@/lib/api/admin-session-routes");
    expect(login).toContain("adminLoginResponse");
    expect(logout).toContain("adminLogoutResponse");
    expect(helper).toContain("parseJsonRequestBody");
    expect(helper).toContain("adminLoginBodySchema");
    expect(helper).toContain("isValidPassword");
    expect(helper).toContain("adminLoginSuccessResponse");
    expect(helper).toContain("adminLoginInvalidResponse");
    expect(helper).toContain("@/lib/api/ok-response");
    expect(helper).toContain("okJson");
    expect(helper).toContain("okError");
    expect(helper).toContain("okEmpty");
    expect(helper).toContain("freshAdminSessionCookie");
    expect(helper).toContain("expiredAdminSessionCookie");
    expect(helper).not.toContain("NextResponse");
    expect(helper).not.toContain("ok: true");
    expect(helper).not.toContain("ok: false");

    for (const source of [login, logout]) {
      expect(source).not.toContain("NextResponse");
      expect(source).not.toContain("freshAdminSessionCookie");
      expect(source).not.toContain("expiredAdminSessionCookie");
      expect(source).not.toContain("ADMIN_SESSION_COOKIE");
      expect(source).not.toContain("sameSite:");
      expect(source).not.toContain("httpOnly:");
      expect(source).not.toContain("secure:");
      expect(source).not.toContain("maxAge:");
    }
    expect(login).not.toContain("@/lib/api/json-body");
    expect(login).not.toContain("parseJsonRequestBody");
    expect(login).not.toContain("isValidPassword");
  });

  test("password module owns the cookie attributes and session value minting", () => {
    const source = read("lib/auth/password.ts");

    expect(source).toContain("ADMIN_SESSION_COOKIE");
    expect(source).toContain("ADMIN_SESSION_MAX_AGE_SECONDS");
    expect(source).toContain("mintSessionCookie()");
    expect(source).toContain("freshAdminSessionCookie");
    expect(source).toContain("expiredAdminSessionCookie");
  });
});
