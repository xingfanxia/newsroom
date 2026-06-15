import { describe, expect, test } from "bun:test";
import { readSource, routeFilesUnder } from "@/tests/helpers/source";

const v1RouteFiles = routeFilesUnder("app/api/v1").sort();

describe("v1 route source contracts", () => {
  test("bearer auth and JSON envelopes are centralized for every v1 handler", () => {
    for (const path of v1RouteFiles) {
      const source = readSource(path);
      const handlerCount =
        source.match(/export async function (GET|POST|PATCH|DELETE)\(/g)
          ?.length ?? 0;

      expect(source, path).toContain("@/lib/api/v1-route");
      expect(source, path).not.toContain("@/lib/auth/api-token");
      expect(source, path).not.toContain("auth instanceof Response");
      expect(source, path).not.toContain("Response.json(");
      expect(source, path).not.toContain('v1Error("server_error"');
      expect(source, path).not.toContain('console.error("[api/v1');
      expect(source.match(/runV1Route\(req/g)?.length ?? 0, path).toBe(
        handlerCount,
      );
    }
  });

  test("the shared helper owns the bearer auth bridge and plain error envelopes", () => {
    const helper = readSource("lib/api/v1-route.ts");

    expect(helper).toContain(
      'import { requireApiToken } from "@/lib/auth/api-token"',
    );
    expect(helper).toContain("export async function runV1Route");
    expect(helper).toContain("export function v1Json");
    expect(helper).toContain("export function v1Error");
    expect(helper).toContain("export function v1RouteResult");
    expect(helper).toContain("export function v1InvalidQuery");
    expect(helper).toContain("export function v1InvalidQueryResult");
    expect(helper).toContain("export function v1ServerError");
    expect(helper).toContain('return v1Error("server_error", 500)');
  });

  test("v1 query parse failures map through the shared route helper", () => {
    for (const path of [
      "app/api/v1/feed/route.ts",
      "app/api/v1/search/route.ts",
      "app/api/v1/saved/route.ts",
      "app/api/v1/usage/summary/route.ts",
    ] as const) {
      const source = readSource(path);

      expect(source, path).toContain("v1InvalidQueryResult(");
      expect(source, path).not.toContain("return v1InvalidQuery(");
    }
  });

  test("v1 domain result failures map through the shared route helper", () => {
    for (const path of [
      "app/api/v1/collections/route.ts",
      "app/api/v1/events/[id]/members/route.ts",
      "app/api/v1/saved/route.ts",
      "app/api/v1/tweaks/route.ts",
    ] as const) {
      const source = readSource(path);

      expect(source, path).toContain("v1RouteResult(");
      expect(source, path).not.toContain("v1Error(result.error");
    }
  });
});
