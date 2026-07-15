import { afterEach, describe, expect, test } from "bun:test";
import { checkSourcePublicDbBoundary } from "@/scripts/ops/check-public-db-boundary";
import {
  cleanupFixtureRoots,
  fixtureRoot,
  writeFixture,
} from "./public-db-boundary-fixtures";

afterEach(cleanupFixtureRoots);

describe("anonymous public DB boundary — runtime loaders", () => {
  test("follows literal dynamic imports and require calls, and fails computed imports closed", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      "app/public/page.tsx",
      'import "@/lib/missing";\nexport async function load() { await import("@/lib/lazy"); require("@/lib/legacy"); }\nconst target = "@/lib/unknown";\nexport const unresolved = import(target);\n',
    );
    writeFixture(root, "lib/lazy.ts", 'export { db } from "@/db/client";\n');
    writeFixture(root, "lib/legacy.ts", "export const legacy = true;\n");
    writeFixture(root, "db/client.ts", "export const db = {};\n");

    const result = checkSourcePublicDbBoundary({
      rootDir: root,
      entrypointSources: ["app/public/page.tsx"],
    });

    expect(result.ok).toBeFalse();
    expect(result.violations.map((violation) => violation.rule)).toContainAllValues([
      "db-source",
      "nonliteral-import",
      "unresolved-internal-import",
    ]);
  });

  test("follows global module.require while ignoring shadowed CommonJS loaders", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      "app/public/page.js",
      'module.require("@/lib/runtime");\nfunction local(module, require) { module.require("@/lib/missing-module"); require("@/lib/missing-require"); }\nexport default function Page() {}\n',
    );
    writeFixture(
      root,
      "lib/runtime.js",
      'require("@libsql/client");\nexport const runtime = true;\n',
    );

    const result = checkSourcePublicDbBoundary({
      rootDir: root,
      entrypointSources: ["app/public/page.js"],
    });

    expect(result.visitedFiles).toContain("lib/runtime.js");
    expect(result.violations.map((violation) => violation.rule)).toContain(
      "libsql-client",
    );
    expect(result.violations.map((violation) => violation.rule)).not.toContain(
      "unresolved-internal-import",
    );
  });

  test("uses parameter scope, not body bindings, for CommonJS default initializers", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      "app/public/page.js",
      'function direct(value = require("@/lib/direct")) { const require = () => {}; return value; }\nfunction viaModule(value = module.require("@/lib/via-module")) { const module = {}; return value; }\nfunction ignored(require, module, a = require("@/lib/missing-a"), b = module.require("@/lib/missing-b")) { return a || b; }\ndirect(); viaModule();\nexport default function Page() {}\n',
    );
    writeFixture(root, "lib/direct.js", "export const direct = true;\n");
    writeFixture(
      root,
      "lib/via-module.js",
      'require("@libsql/client");\nexport const viaModule = true;\n',
    );

    const result = checkSourcePublicDbBoundary({
      rootDir: root,
      entrypointSources: ["app/public/page.js"],
    });

    expect(result.visitedFiles).toContain("lib/direct.js");
    expect(result.visitedFiles).toContain("lib/via-module.js");
    expect(result.violations.map((violation) => violation.rule)).toContain(
      "libsql-client",
    );
    expect(result.violations.map((violation) => violation.rule)).not.toContain(
      "unresolved-internal-import",
    );
  });

  test("fails closed for aliases of unshadowed CommonJS loaders", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      "app/public/page.js",
      'const load = require;\nload("@/lib/hidden");\nconst bound = module.require.bind(module);\nbound("@/lib/also-hidden");\nexport default function Page() {}\n',
    );

    const result = checkSourcePublicDbBoundary({
      rootDir: root,
      entrypointSources: ["app/public/page.js"],
    });

    expect(result.violations.map((violation) => violation.rule)).toContain(
      "nonliteral-import",
    );
  });

  test("does not treat CommonJS property and type names as loader references", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      "app/public/page.ts",
      'type Shape = { require: string; module: string };\nconst shape: Shape = { require: "value", module: "value" };\nmodule.require("@/lib/pure");\nexport default shape;\n',
    );
    writeFixture(root, "lib/pure.ts", "export const pure = true;\n");

    const result = checkSourcePublicDbBoundary({
      rootDir: root,
      entrypointSources: ["app/public/page.ts"],
    });

    expect(result.ok).toBeTrue();
    expect(result.visitedFiles).toContain("lib/pure.ts");
  });

  test("allows static module.exports in pure CommonJS dependencies", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      "app/public/page.tsx",
      'import pure from "@/lib/pure.cjs";\nexport default pure;\n',
    );
    writeFixture(root, "lib/pure.cjs", "module.exports = { pure: true };\n");

    const result = checkSourcePublicDbBoundary({
      rootDir: root,
      entrypointSources: ["app/public/page.tsx"],
    });

    expect(result.ok).toBeTrue();
    expect(result.visitedFiles).toContain("lib/pure.cjs");
  });

  test("scans runtime siblings hidden by local declarations without expanding type-only imports", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      "app/public/page.tsx",
      'import { runtime } from "@/lib/loader";\nimport type { Pure } from "@/lib/type-only";\nexport default function Page(): Pure { return runtime; }\n',
    );
    writeFixture(root, "lib/loader.d.ts", "export declare const runtime: {};\n");
    writeFixture(
      root,
      "lib/loader.js",
      'require("@libsql/client");\nexports.runtime = {};\n',
    );
    writeFixture(root, "lib/type-only.d.ts", "export interface Pure {}\n");
    writeFixture(
      root,
      "lib/type-only.js",
      'require("@libsql/client");\nexports.value = {};\n',
    );

    const result = checkSourcePublicDbBoundary({
      rootDir: root,
      entrypointSources: ["app/public/page.tsx"],
    });

    for (const source of [
      "lib/loader.d.ts",
      "lib/loader.js",
      "lib/type-only.d.ts",
    ]) {
      expect(result.visitedFiles).toContain(source);
    }
    expect(result.visitedFiles).not.toContain("lib/type-only.js");
    expect(
      result.violations.filter(
        (violation) => violation.rule === "libsql-client",
      ),
    ).toHaveLength(1);
  });

  test("fails closed when a runtime import resolves only to a declaration file", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      "app/public/page.tsx",
      'import { missingRuntime } from "@/lib/declaration-only";\nexport default missingRuntime;\n',
    );
    writeFixture(
      root,
      "lib/declaration-only.d.ts",
      "export declare const missingRuntime: unknown;\n",
    );

    const result = checkSourcePublicDbBoundary({
      rootDir: root,
      entrypointSources: ["app/public/page.tsx"],
    });

    expect(result.violations.map((violation) => violation.rule)).toContain(
      "unresolved-internal-import",
    );
  });

  test("keeps edges originating in declaration files type-only", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      "app/public/page.tsx",
      'import type { A } from "@/lib/a";\nexport default function Page(): A { return {} as A; }\n',
    );
    writeFixture(
      root,
      "lib/a.d.ts",
      'import { B } from "./b";\nexport interface A extends B {}\n',
    );
    writeFixture(root, "lib/b.d.ts", "export interface B {}\n");
    writeFixture(
      root,
      "lib/b.js",
      'require("@libsql/client");\nexports.value = {};\n',
    );

    const result = checkSourcePublicDbBoundary({
      rootDir: root,
      entrypointSources: ["app/public/page.tsx"],
    });

    expect(result.ok).toBeTrue();
    expect(result.visitedFiles).toContain("lib/a.d.ts");
    expect(result.visitedFiles).toContain("lib/b.d.ts");
    expect(result.visitedFiles).not.toContain("lib/b.js");
  });

  test("fails closed on runtime module loaders while allowing type-only module imports", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      "app/unsafe/page.tsx",
      'import { createRequire } from "node:module";\nconst req = createRequire(import.meta.url);\nreq("@libsql/client");\nexport default function Page() {}\n',
    );
    writeFixture(
      root,
      "app/types/page.tsx",
      'import type { Module } from "node:module";\nexport default function Page(): null { return null as Module | null; }\n',
    );

    const unsafe = checkSourcePublicDbBoundary({
      entrypointSources: ["app/unsafe/page.tsx"],
      rootDir: root,
    });
    const typesOnly = checkSourcePublicDbBoundary({
      entrypointSources: ["app/types/page.tsx"],
      rootDir: root,
    });

    expect(unsafe.ok).toBeFalse();
    expect(unsafe.violations.map(({ rule }) => rule)).toContain(
      "nonliteral-import",
    );
    expect(typesOnly.ok).toBeTrue();
  });

});
