import { afterEach, describe, expect, test } from "bun:test";
import {
  discoverSourceEntrypoints,
  discoverSourceRouteModules,
  validateEntrypointInventory,
} from "@/scripts/verification/discover-public-entrypoints";
import {
  cleanupFixtures,
  fixtureRoot,
  writeFixture,
} from "./public-entrypoints-fixtures";

afterEach(cleanupFixtures);

describe("public entrypoint TypeScript runtime exports", () => {
  test("classifies every runtime GET export form instead of suppressing its bundle", () => {
    const root = fixtureRoot();
    writeFixture(root, "app/api/shared/handler.ts", "export const value = 1;\n");
    writeFixture(root, "app/api/namespace-export/route.ts", 'export * as GET from "../shared/handler";\n');
    writeFixture(root, "app/api/namespace-declaration/route.ts", "export namespace GET { export const value = 1; }\n");
    writeFixture(root, "app/api/import-equals/route.ts", 'export import GET = require("../shared/handler");\n');
    writeFixture(root, "app/api/export-equals/route.ts", "const GET = () => new Response();\nexport = { GET };\n");

    const sourceEntrypoints = discoverSourceEntrypoints(root);
    const sourceRouteModules = discoverSourceRouteModules(root);
    const appPaths = [
      "/api/export-equals/route",
      "/api/import-equals/route",
      "/api/namespace-declaration/route",
      "/api/namespace-export/route",
    ];
    expect(sourceEntrypoints.map(({ appPath, methods }) => ({ appPath, methods }))).toEqual(
      appPaths.map((appPath) => ({ appPath, methods: ["GET", "HEAD"] })),
    );

    const builtAppPaths = Object.fromEntries(
      sourceRouteModules.map(({ appPath, buildModule }) => [appPath, buildModule]),
    );
    const validation = validateEntrypointInventory({
      builtAppPaths,
      inventory: [],
      sourceEntrypoints,
      sourceRouteModules,
    });
    expect(validation.builtEntrypoints).toEqual(appPaths);
    expect(validation.unclassifiedBuild).toEqual(appPaths);
  });

  test("fails loud when an export-equals target cannot prove its runtime keys", () => {
    const root = fixtureRoot();
    writeFixture(root, "app/api/unknown/route.ts", "const handlers = getHandlers();\nexport = handlers;\n");
    expect(() => discoverSourceEntrypoints(root)).toThrow(
      /Unsupported export-equals runtime target/,
    );
  });
});
