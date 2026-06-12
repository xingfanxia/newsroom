import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();

const protectedAdminRoutePaths = [
  "app/api/admin/collections/route.ts",
  "app/api/admin/policy/commit/route.ts",
  "app/api/admin/iterations/[id]/route.ts",
  "app/api/admin/iterations/[id]/apply/route.ts",
  "app/api/admin/iterations/[id]/reject/route.ts",
  "app/api/admin/iterations/run/route.ts",
] as const;

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

describe("protected admin route source wiring", () => {
  test("all protected admin routes share admin auth response handling", () => {
    for (const path of protectedAdminRoutePaths) {
      const source = read(path);

      expect(source).toContain("@/lib/api/admin-auth");
      expect(source).toContain("requireAdminForRoute");
      expect(source).not.toContain("getSessionUser");
      expect(source).not.toContain('{ ok: false, error: "auth_required" }');
      expect(source).not.toContain("UnauthorizedError");
      expect(source).not.toContain("ForbiddenError");
    }
  });
});
