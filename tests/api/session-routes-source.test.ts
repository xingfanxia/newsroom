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
  test("session route helper centralizes auth and aliases shared ok/error envelopes", () => {
    const source = read("lib/api/session-route.ts");

    expect(source).toContain("@/lib/api/session-auth");
    expect(source).toContain("@/lib/api/ok-response");
    expect(source).toContain("runSessionRoute");
    expect(source).toContain("sessionJson");
    expect(source).toContain("sessionOk");
    expect(source).toContain("sessionError");
    expect(source).toContain("sessionServerError");
    expect(source).not.toContain("Response.json({ ok:");
  });

  test("cookie-gated user routes share session auth response handling", () => {
    for (const path of requiredSessionRoutePaths) {
      const source = read(path);

      expect(source).toContain("@/lib/api/session-route");
      expect(source).toContain("runSessionRoute");
      expect(source).not.toContain("@/lib/api/session-auth");
      expect(source).not.toContain("requireSessionForRoute");
      expect(source).not.toContain("getSessionUser");
      expect(source).not.toContain('{ ok: false, error: "auth_required" }');
      expect(source).not.toContain("NextResponse.json(");
      expect(source).not.toContain('console.error("[api/feedback');
      expect(source).not.toContain('sessionError("server_error"');
    }
  });

  test("saved move route shares request validation with saved API schemas", () => {
    const source = read("app/api/feedback/move/route.ts");

    expect(source).toContain("@/lib/api/saved-requests");
    expect(source).toContain("feedbackMoveBodySchema");
    expect(source).not.toContain('from "zod"');
    expect(source).not.toContain("const bodySchema = z.object");
  });

  test("optional saved export keeps its fallback-user semantics explicit", () => {
    const source = read("app/api/saved/export/route.ts");
    const helper = read("lib/api/saved-export.ts");

    expect(source).toContain("getSessionUser");
    expect(source).toContain("ADMIN_USER_ID");
    expect(source).toContain("@/lib/api/saved-export");
    expect(source).toContain("savedExportResponse(req, userId)");
    expect(source).not.toContain("requireSessionForRoute");
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
