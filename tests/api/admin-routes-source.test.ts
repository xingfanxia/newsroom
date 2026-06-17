import { describe, expect, test } from "bun:test";
import { readSource as read } from "@/tests/helpers/source";

const protectedAdminRoutePaths = [
  "app/api/admin/collections/route.ts",
  "app/api/admin/policy/commit/route.ts",
  "app/api/admin/iterations/[id]/route.ts",
  "app/api/admin/iterations/[id]/apply/route.ts",
  "app/api/admin/iterations/[id]/reject/route.ts",
  "app/api/admin/iterations/run/route.ts",
] as const;
const standardAdminRoutePaths = [
  "app/api/admin/collections/route.ts",
  "app/api/admin/policy/commit/route.ts",
] as const;

describe("protected admin route source wiring", () => {
  test("admin route helper centralizes auth and aliases shared ok/error envelopes", () => {
    const source = read("lib/api/admin-route.ts");

    expect(source).toContain("@/lib/api/admin-auth");
    expect(source).toContain("@/lib/api/ok-response");
    expect(source).toContain("@/lib/api/route-result");
    expect(source).toContain("runAdminRoute");
    expect(source).toContain("adminJson");
    expect(source).toContain("adminOk");
    expect(source).toContain("adminError");
    expect(source).toContain("adminRouteResult");
    expect(source).toContain("adminServerError");
    expect(source).toContain("serverErrorLabel?: string");
    expect(source).toContain("serverErrorExtra?:");
    expect(source).toContain("export type AdminRouteResult<T = undefined> = RouteResult<T>");
    expect(source).toContain("return onOk(routeResultPayload(result))");
    expect(source).toContain("return adminServerError(opts.serverErrorLabel, err, extra)");
    expect(source).not.toContain("Response.json({ ok:");
  });

  test("all protected admin routes share admin auth response handling", () => {
    for (const path of protectedAdminRoutePaths) {
      const source = read(path);

      if (path.includes("/iterations/[id]/")) {
        expect(source).toContain("@/lib/api/iteration-routes");
        expect(source).toContain("runAdminIterationIdRoute");
        expect(source).not.toContain("@/lib/api/admin-route");
        expect(source).not.toContain("runAdminRoute");
      } else if (path.includes("/iterations/run/")) {
        expect(source).toContain("@/lib/api/iteration-routes");
        expect(source).toContain("runAdminIterationStartRoute");
        expect(source).not.toContain("@/lib/api/admin-route");
        expect(source).not.toContain("runAdminRoute");
      } else {
        expect(source).toContain("@/lib/api/admin-route");
        expect(source).toContain("runAdminRoute");
      }
      expect(source).not.toContain("@/lib/api/admin-auth");
      expect(source).not.toContain("requireAdminForRoute");
      expect(source).not.toContain("NextResponse.json(");
      expect(source).not.toContain("getSessionUser");
      expect(source).not.toContain('{ ok: false, error: "auth_required" }');
      expect(source).not.toContain("UnauthorizedError");
      expect(source).not.toContain("ForbiddenError");
      expect(source).not.toContain('console.error("[api/admin');
      expect(source).not.toContain('adminError("server_error"');
    }
  });

  test("standard protected admin routes delegate catch-all server errors to runAdminRoute", () => {
    for (const path of standardAdminRoutePaths) {
      const source = read(path);
      const handlerCount = source.match(/runAdminRoute\(async/g)?.length ?? 0;

      expect(source.match(/serverErrorLabel:/g)?.length ?? 0, path).toBe(
        handlerCount,
      );
      expect(source).not.toContain("adminServerError");
      expect(source).not.toContain("try {");
      expect(source).not.toContain("catch (");
    }
  });

  test("policy commit route delegates request schema and commit mapping", () => {
    const route = read("app/api/admin/policy/commit/route.ts");
    const helper = read("lib/api/policy-commit.ts");

    expect(route).toContain("@/lib/api/policy-commit");
    expect(route).toContain("policyCommitBodySchema");
    expect(route).toContain("commitPolicyRoutePayload");
    expect(route).not.toContain('from "zod"');
    expect(route).not.toContain("const bodySchema = z.object");
    expect(route).not.toContain("@/lib/policy/skill");
    expect(route).not.toContain("commitSkillVersion");
    expect(route).not.toContain("feedbackSample");
    expect(route).not.toContain("feedbackCount");

    expect(helper).toContain("policyCommitBodySchema");
    expect(helper).toContain("commitSkillVersion");
    expect(helper).toContain("committedBy: user.email");
  });
});
