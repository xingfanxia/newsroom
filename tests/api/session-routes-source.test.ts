import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();

const requiredSessionRoutePaths = [
  "app/api/feedback/route.ts",
  "app/api/feedback/move/route.ts",
  "app/api/tweaks/route.ts",
] as const;

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

describe("required session route source wiring", () => {
  test("cookie-gated user routes share session auth response handling", () => {
    for (const path of requiredSessionRoutePaths) {
      const source = read(path);

      expect(source).toContain("@/lib/api/session-auth");
      expect(source).toContain("requireSessionForRoute");
      expect(source).not.toContain("getSessionUser");
      expect(source).not.toContain('{ ok: false, error: "auth_required" }');
    }
  });

  test("optional saved export keeps its fallback-user semantics explicit", () => {
    const source = read("app/api/saved/export/route.ts");

    expect(source).toContain("getSessionUser");
    expect(source).toContain("ADMIN_USER_ID");
    expect(source).not.toContain("requireSessionForRoute");
  });
});
