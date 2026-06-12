import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const routePaths = [
  "app/api/admin/iterations/[id]/route.ts",
  "app/api/admin/iterations/[id]/apply/route.ts",
  "app/api/admin/iterations/[id]/reject/route.ts",
] as const;

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

describe("admin iteration route source wiring", () => {
  test("all id routes share iteration run route-id parsing", () => {
    for (const path of routePaths) {
      const source = read(path);

      expect(source).toContain("@/lib/policy/iterations");
      expect(source).toContain("parseIterationRunRouteId");
      expect(source).not.toContain("Number(rawId)");
      expect(source).not.toContain("Number.isInteger(id)");
    }
  });
});
