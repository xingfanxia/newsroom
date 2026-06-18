import { describe, expect, test } from "bun:test";
import { readSource as read } from "@/tests/helpers/source";

const sharedJsonBodyRoutePaths = [
  "app/api/admin/collections/route.ts",
  "app/api/admin/policy/commit/route.ts",
  "app/api/feedback/route.ts",
  "app/api/feedback/move/route.ts",
  "app/api/tweaks/route.ts",
  "app/api/v1/collections/route.ts",
  "app/api/v1/saved/route.ts",
  "app/api/v1/tweaks/route.ts",
] as const;
const sharedJsonBodyHelperPaths = [
  "lib/api/admin-session-routes.ts",
] as const;
const sharedJsonBodySourcePaths = [
  ...sharedJsonBodyRoutePaths,
  ...sharedJsonBodyHelperPaths,
] as const;

describe("JSON body parsing source wiring", () => {
  test("JSON body parse failures reuse shared response envelope helpers", () => {
    const source = read("lib/api/json-body.ts");

    expect(source).toContain("@/lib/api/ok-response");
    expect(source).toContain("@/lib/api/plain-response");
    expect(source).toContain("okError(error, 400, issuePayload)");
    expect(source).toContain("plainError(error, 400, issuePayload)");
    expect(source).not.toContain("Response.json(body");
    expect(source).not.toContain("ok: false, error");
    expect(source).not.toContain("{ error, ...issuePayload }");
  });

  test("mutating API routes share JSON parse and Zod error handling", () => {
    for (const path of sharedJsonBodySourcePaths) {
      const source = read(path);

      expect(source).toContain("@/lib/api/json-body");
      expect(source).toContain("parseJsonRequestBody");
      expect(source).not.toContain("let raw: unknown");
      expect(source).not.toContain("raw = await req.json()");
      expect(source).not.toContain("safeParse(raw)");
    }
  });

  test("each surface keeps its intended error envelope", () => {
    for (const path of sharedJsonBodySourcePaths) {
      const source = read(path);
      const expectedEnvelope = path.includes("/api/v1/") ? "plain" : "ok";

      expect(source).toContain(`envelope: "${expectedEnvelope}"`);
    }
  });

  test("admin login route delegates JSON parsing to admin session helpers", () => {
    const route = read("app/api/admin/auth/route.ts");

    expect(route).toContain("@/lib/api/admin-session-routes");
    expect(route).toContain("adminLoginResponse(req)");
    expect(route).not.toContain("@/lib/api/json-body");
    expect(route).not.toContain("parseJsonRequestBody");
    expect(route).not.toContain("adminLoginBodySchema");
  });
});
