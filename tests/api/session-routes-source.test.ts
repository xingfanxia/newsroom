import { describe, expect, test } from "bun:test";
import { readSource as read } from "@/tests/helpers/source";

const requiredSessionRoutePaths = [
  "app/api/feedback/route.ts",
  "app/api/feedback/move/route.ts",
  "app/api/tweaks/route.ts",
] as const;

describe("required session route source wiring", () => {
  test("session route helper centralizes auth and aliases shared ok/error envelopes", () => {
    const source = read("lib/api/session-route.ts");

    expect(source).toContain("@/lib/api/session-auth");
    expect(source).toContain("@/lib/api/ok-response");
    expect(source).toContain("@/lib/api/route-result");
    expect(source).toContain("runSessionRoute");
    expect(source).toContain("sessionJson");
    expect(source).toContain("sessionOk");
    expect(source).toContain("sessionError");
    expect(source).toContain("sessionRouteResult");
    expect(source).toContain("sessionServerError");
    expect(source).toContain("serverErrorLabel?: string");
    expect(source).toContain("export type SessionRouteResult<T = undefined> = RouteResult<T>");
    expect(source).toContain("return onOk(routeResultPayload(result))");
    expect(source).toContain(
      "return sessionServerError(opts.serverErrorLabel, err)",
    );
    expect(source).not.toContain("Response.json({ ok:");
  });

  test("cookie-gated user routes share session auth response handling", () => {
    for (const path of requiredSessionRoutePaths) {
      const source = read(path);
      const handlerCount = source.match(/runSessionRoute\(async/g)?.length ?? 0;

      expect(source).toContain("@/lib/api/session-route");
      expect(source).toContain("runSessionRoute");
      expect(source.match(/serverErrorLabel:/g)?.length ?? 0, path).toBe(
        handlerCount,
      );
      expect(source).not.toContain("@/lib/api/session-auth");
      expect(source).not.toContain("requireSessionForRoute");
      expect(source).not.toContain("getSessionUser");
      expect(source).not.toContain('{ ok: false, error: "auth_required" }');
      expect(source).not.toContain("NextResponse.json(");
      expect(source).not.toContain("sessionServerError");
      expect(source).not.toContain("try {");
      expect(source).not.toContain("catch (");
      expect(source).not.toContain('console.error("[api/feedback');
      expect(source).not.toContain('sessionError("server_error"');
    }
  });

  test("cookie auth denial helpers reuse shared ok/error envelopes", () => {
    const sessionAuth = read("lib/api/session-auth.ts");
    const adminAuth = read("lib/api/admin-auth.ts");

    for (const source of [sessionAuth, adminAuth]) {
      expect(source).toContain("@/lib/api/ok-response");
      expect(source).toContain("okError");
      expect(source).not.toContain("NextResponse");
      expect(source).not.toContain("NextResponse.json(");
      expect(source).not.toContain("error: \"auth_required\"");
      expect(source).not.toContain("error: \"admin_required\"");
    }
  });

  test("saved move route shares request validation with saved API schemas", () => {
    const source = read("app/api/feedback/move/route.ts");

    expect(source).toContain("@/lib/api/saved-requests");
    expect(source).toContain("feedbackMoveBodySchema");
    expect(source).toContain("@/lib/api/saved-routes");
    expect(source).toContain("moveSavedItemRoutePayload");
    expect(source).toContain("sessionRouteResult(");
    expect(source).not.toContain("sessionError(result.error");
    expect(source).not.toContain('from "zod"');
    expect(source).not.toContain("const bodySchema = z.object");
    expect(source).not.toContain("@/lib/items/collections");
    expect(source).not.toContain("moveItemToCollection");
    expect(source).not.toContain("upsertAppUser");
  });

  test("saved export requires a session before invoking export body logic", () => {
    const source = read("app/api/saved/export/route.ts");
    const helper = read("lib/api/saved-export.ts");

    expect(source).toContain("runSessionRoute");
    expect(source).toContain("@/lib/api/saved-export");
    expect(source).toContain("savedExportResponse(req, user.id)");
    expect(source).not.toContain("ADMIN_USER_ID");
    expect(source).not.toContain("getSessionUser");
    expect(source).not.toContain("new URL(req.url)");
    expect(source).not.toContain("searchParams.get");
    expect(source).not.toContain("@/lib/items/saved");
    expect(source).not.toContain("@/lib/items/collections");
    expect(source).not.toContain("Content-Disposition");

    expect(helper).toContain("getSavedStories");
    expect(helper).toContain("listCollections");
    expect(helper).toContain("Content-Disposition");
  });
});
