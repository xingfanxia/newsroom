import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const routePaths = [
  "app/api/admin/iterations/[id]/route.ts",
  "app/api/admin/iterations/[id]/apply/route.ts",
  "app/api/admin/iterations/[id]/reject/route.ts",
] as const;
const allIterationRoutePaths = [
  ...routePaths,
  "app/api/admin/iterations/run/route.ts",
] as const;

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

describe("admin iteration route source wiring", () => {
  test("all routes share admin auth response handling", () => {
    for (const path of allIterationRoutePaths) {
      const source = read(path);

      expect(source).toContain("@/lib/api/admin-route");
      expect(source).toContain("runAdminRoute");
      expect(source).not.toContain("@/lib/api/admin-auth");
      expect(source).not.toContain("requireAdminForRoute");
      expect(source).not.toContain("NextResponse.json(");
      expect(source).not.toContain("UnauthorizedError");
      expect(source).not.toContain("ForbiddenError");
      expect(source).not.toContain("requireAdmin,");
    }
  });

  test("all id routes share iteration run route-id parsing", () => {
    for (const path of routePaths) {
      const source = read(path);

      expect(source).toContain("@/lib/policy/iterations");
      expect(source).toContain("parseIterationRunRouteId");
      expect(source).not.toContain("Number(rawId)");
      expect(source).not.toContain("Number.isInteger(id)");
    }
  });

  test("id routes delegate DB/status/commit semantics to a shared API helper", () => {
    const helper = read("lib/api/iteration-routes.ts");

    expect(helper).toContain("@/db/client");
    expect(helper).toContain("@/db/schema");
    expect(helper).toContain("getIterationRunRoutePayload");
    expect(helper).toContain("applyIterationRunRoutePayload");
    expect(helper).toContain("rejectIterationRunRoutePayload");
    expect(helper).toContain("commitSkillVersion");
    expect(helper).toContain("invalidatePolicyCache");

    for (const path of routePaths) {
      const source = read(path);

      expect(source).toContain("@/lib/api/iteration-routes");
      expect(source).not.toContain("@/db/client");
      expect(source).not.toContain("@/db/schema");
      expect(source).not.toContain("from \"drizzle-orm\"");
      expect(source).not.toContain("commitSkillVersion");
      expect(source).not.toContain("invalidatePolicyCache");
      expect(source).not.toContain("ITERATION_PROPOSED_STATUS");
    }
  });
});
