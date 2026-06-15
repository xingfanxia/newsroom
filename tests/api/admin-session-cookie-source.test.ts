import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

describe("admin session cookie source wiring", () => {
  test("login and logout routes share admin session response helpers", () => {
    const login = read("app/api/admin/auth/route.ts");
    const logout = read("app/api/admin/logout/route.ts");
    const helper = read("lib/api/admin-session-routes.ts");

    expect(login).toContain("@/lib/api/admin-session-routes");
    expect(logout).toContain("@/lib/api/admin-session-routes");
    expect(login).toContain("adminLoginSuccessResponse");
    expect(login).toContain("adminLoginInvalidResponse");
    expect(logout).toContain("adminLogoutResponse");
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
