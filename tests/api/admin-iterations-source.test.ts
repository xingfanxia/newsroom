import { describe, expect, test } from "bun:test";
import { readSource as read } from "@/tests/helpers/source";

const routePaths = [
  "app/api/admin/iterations/[id]/route.ts",
  "app/api/admin/iterations/[id]/apply/route.ts",
  "app/api/admin/iterations/[id]/reject/route.ts",
] as const;

describe("admin iteration route source wiring", () => {
  test("all routes share admin auth response handling", () => {
    for (const path of routePaths) {
      const source = read(path);

      expect(source).toContain("@/lib/api/iteration-routes");
      expect(source).toContain("runAdminIterationIdRoute");
      expect(source).not.toContain("@/lib/api/admin-route");
      expect(source).not.toContain("runAdminRoute");
      expect(source).not.toContain("@/lib/api/admin-auth");
      expect(source).not.toContain("requireAdminForRoute");
      expect(source).not.toContain("NextResponse.json(");
      expect(source).not.toContain("UnauthorizedError");
      expect(source).not.toContain("ForbiddenError");
      expect(source).not.toContain("requireAdmin,");
    }

    const runRoute = read("app/api/admin/iterations/run/route.ts");
    expect(runRoute).toContain("@/lib/api/admin-route");
    expect(runRoute).toContain("runAdminRoute");
  });

  test("all id routes delegate iteration run route-id parsing to the shared helper", () => {
    const helper = read("lib/api/iteration-routes.ts");

    expect(helper).toContain("parseIterationRunRouteId");
    expect(helper).toContain("runAdminIterationIdRoute");
    expect(helper).toContain("adminError(parsedId.error, 400)");

    for (const path of routePaths) {
      const source = read(path);

      expect(source).not.toContain("@/lib/policy/iterations");
      expect(source).not.toContain("parseIterationRunRouteId");
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
    expect(helper).toContain("runAdminIterationIdRoute");
    expect(helper).toContain("runAdminRoute");
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
