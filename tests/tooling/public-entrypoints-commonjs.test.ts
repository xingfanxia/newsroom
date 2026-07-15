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

describe("public entrypoint CommonJS runtime exports", () => {
  test("discovers top-level CommonJS route values while ignoring POST-only and shadowed locals", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      "app/api/exports/route.js",
      "exports.GET = async function GET() { return new Response(); };\n",
    );
    writeFixture(
      root,
      "app/api/module-property/route.js",
      "module.exports.GET = async function GET() { return new Response(); };\n",
    );
    writeFixture(
      root,
      "app/api/object/route.js",
      "const GET = async () => new Response();\nmodule.exports = { GET, HEAD: GET, POST() {} };\n",
    );
    writeFixture(
      root,
      "app/api/post-only/route.js",
      "exports.POST = async function POST() { return new Response(); };\n",
    );
    writeFixture(
      root,
      "app/api/shadowed/route.js",
      "function configure(exports) { exports.GET = () => new Response(); }\nconfigure({});\n",
    );

    expect(
      discoverSourceEntrypoints(root).map(({ appPath, methods }) => ({
        appPath,
        methods,
      })),
    ).toEqual([
      { appPath: "/api/exports/route", methods: ["GET", "HEAD"] },
      { appPath: "/api/module-property/route", methods: ["GET", "HEAD"] },
      { appPath: "/api/object/route", methods: ["GET", "HEAD"] },
    ]);
  });

  test("discovers static bracket CommonJS route exports", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      "app/api/module-bracket-property/route.js",
      'module["exports"].GET = async function GET() { return new Response(); };\n',
    );
    writeFixture(
      root,
      "app/api/module-bracket-nested/route.js",
      'module["exports"]["GET"] = async function GET() { return new Response(); };\n',
    );
    writeFixture(
      root,
      "app/api/module-bracket-object/route.js",
      'const GET = async () => new Response();\nmodule["exports"] = { GET };\n',
    );

    expect(
      discoverSourceEntrypoints(root).map(({ appPath, methods }) => ({
        appPath,
        methods,
      })),
    ).toEqual([
      { appPath: "/api/module-bracket-nested/route", methods: ["GET", "HEAD"] },
      { appPath: "/api/module-bracket-object/route", methods: ["GET", "HEAD"] },
      { appPath: "/api/module-bracket-property/route", methods: ["GET", "HEAD"] },
    ]);
  });

  test("does not let erased TypeScript bindings hide CommonJS GET exports", () => {
    const root = fixtureRoot();
    writeFixture(root, "app/api/ambient/types.ts", "export interface Module {}\n");
    writeFixture(
      root,
      "app/api/ambient/route.ts",
      'declare const module: { exports: Record<string, unknown> };\nmodule["exports"]["GET"] = async () => new Response();\n',
    );
    writeFixture(root, "app/api/type-import/types.ts", "export interface Module {}\n");
    writeFixture(
      root,
      "app/api/type-import/route.ts",
      'import type { Module as module } from "./types";\nmodule.exports.GET = async () => new Response();\n',
    );

    expect(
      discoverSourceEntrypoints(root).map(({ appPath, methods }) => ({
        appPath,
        methods,
      })),
    ).toEqual([
      { appPath: "/api/ambient/route", methods: ["GET", "HEAD"] },
      { appPath: "/api/type-import/route", methods: ["GET", "HEAD"] },
    ]);
  });

  test("fails loud for unsupported top-level CommonJS export mutations", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      "app/api/unsupported/route.js",
      "const GET = () => new Response();\nObject.assign(module.exports, { GET });\n",
    );
    expect(() => discoverSourceEntrypoints(root)).toThrow(
      /Unsupported CommonJS export mutation/,
    );
  });

  test("fails loud for indirect global module references", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      "app/api/indirect-module/route.js",
      "const target = module;\ntarget.exports.GET = () => new Response();\n",
    );
    expect(() => discoverSourceEntrypoints(root)).toThrow(
      /Unsupported CommonJS export mutation.*indirect module reference/,
    );
  });

  test("fails loud for nested global CommonJS mutations instead of silently filtering", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      "app/api/nested/route.js",
      "function configure() { exports.GET = () => new Response(); }\nconfigure();\n",
    );
    expect(() => discoverSourceEntrypoints(root)).toThrow(
      /Unsupported CommonJS export mutation/,
    );
  });

  test("fails loud for conditional CommonJS mutations instead of proving POST-only", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      "app/api/conditional/route.js",
      "if (true) { exports.GET = () => new Response(); }\n",
    );
    expect(() => discoverSourceEntrypoints(root)).toThrow(
      /Unsupported CommonJS export mutation/,
    );
  });

  test("fails loud when a default parameter mutates global CommonJS exports", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      "app/api/default-parameter/route.js",
      "function configure(value = (module.exports.GET = () => new Response())) { const module = {}; return value; }\nconfigure();\n",
    );
    expect(() => discoverSourceEntrypoints(root)).toThrow(
      /Unsupported CommonJS export mutation.*nested or conditional assignment/,
    );
  });

  test("treats external export-star runtime ambiguity as serving, never POST-only", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      "app/api/package/route.ts",
      'export * from "route-handler-pkg";\n',
    );
    writeFixture(
      root,
      "node_modules/route-handler-pkg/package.json",
      JSON.stringify({
        name: "route-handler-pkg",
        exports: { ".": { types: "./index.d.ts", default: "./index.js" } },
      }),
    );
    writeFixture(
      root,
      "node_modules/route-handler-pkg/index.d.ts",
      "export declare function POST(): Promise<Response>;\n",
    );
    writeFixture(
      root,
      "node_modules/route-handler-pkg/index.js",
      "exports.GET = async () => new Response();\n",
    );

    const sourceEntrypoints = discoverSourceEntrypoints(root);
    const sourceRouteModules = discoverSourceRouteModules(root);
    expect(
      sourceEntrypoints.map(({ appPath, methods }) => ({ appPath, methods })),
    ).toEqual([{ appPath: "/api/package/route", methods: ["GET", "HEAD"] }]);
    expect(sourceRouteModules[0]?.methods).toEqual(["GET", "HEAD"]);

    const validation = validateEntrypointInventory({
      sourceEntrypoints,
      sourceRouteModules,
      builtAppPaths: { "/api/package/route": "app/api/package/route.js" },
      inventory: [],
    });
    expect(validation.unclassifiedSource).toEqual(["/api/package/route"]);
    expect(validation.unclassifiedBuild).toEqual(["/api/package/route"]);
  });
});
