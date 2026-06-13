import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

const cookieRoute = read("app/api/tweaks/route.ts");
const v1Route = read("app/api/v1/tweaks/route.ts");
const sharedRouteHelper = read("lib/api/tweak-routes.ts");
const hook = read("hooks/use-tweaks.tsx");

describe("tweaks route source wiring", () => {
  test("cookie and v1 routes share request validation", () => {
    for (const source of [cookieRoute, v1Route]) {
      expect(source).toContain("@/lib/api/tweak-requests");
      expect(source).toContain("tweaksPatchBodySchema");
      expect(source).not.toContain("const tweaksSchema = z.object");
      expect(source).not.toContain("const tweaksShape = z.object");
      expect(source).not.toContain("const bodySchema = z.object");
      expect(source).not.toContain("const patchSchema = z.object");
      expect(source).not.toContain("const patch: Record<string, unknown>");
    }
  });

  test("cookie and v1 routes share tweaks persistence payload helpers", () => {
    expect(sharedRouteHelper).toContain("buildTweaksDbPatch");
    expect(sharedRouteHelper).toContain("upsertAppUser");
    expect(sharedRouteHelper).toContain("getTweaksRoutePayload");
    expect(sharedRouteHelper).toContain("saveTweaksRoutePayload");

    for (const source of [cookieRoute, v1Route]) {
      expect(source).toContain("@/lib/api/tweak-routes");
      expect(source).not.toContain("buildTweaksDbPatch");
      expect(source).not.toContain("@/db/client");
      expect(source).not.toContain("@/db/schema");
      expect(source).not.toContain("upsertAppUser");
      expect(source).not.toContain(".update(users)");
      expect(source).not.toContain(".select({ tweaks:");
    }
  });

  test("client tweaks state uses the same source-of-truth defaults as API schemas", () => {
    expect(hook).toContain("@/lib/tweaks");
    expect(hook).not.toContain('density: "compact" | "comfy" | "reader"');
    expect(hook).not.toContain('accent: "green" | "blue"');
  });
});
