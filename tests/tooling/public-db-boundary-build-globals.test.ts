import { afterEach, describe, expect, test } from "bun:test";
import { checkBuiltPublicDbBoundary } from "@/scripts/ops/check-public-db-boundary";
import {
  cleanupFixtureRoots,
  fixtureRoot,
  tursoDatabaseUrlKey,
  writeBuildModule,
  writeFixture,
} from "./public-db-boundary-fixtures";

afterEach(cleanupFixtureRoots);

describe("anonymous public DB boundary — global build artifacts", () => {
  test("scans dedicated proxy and instrumentation output traces", () => {
    const root = fixtureRoot();
    writeFixture(root, "proxy.ts", "export default function proxy() {}\n");
    writeFixture(
      root,
      "instrumentation.ts",
      "export function register() {}\n",
    );
    writeFixture(root, ".next/server/app-paths-manifest.json", "{}");
    writeFixture(
      root,
      ".next/server/middleware-manifest.json",
      JSON.stringify({
        functions: {},
        middleware: {},
        sortedMiddleware: [],
        version: 3,
      }),
    );
    writeBuildModule(root, "middleware.js");
    writeBuildModule(root, "instrumentation.js");
    writeFixture(root, "node_modules/@libsql/client/index.js", "export {};\n");
    writeFixture(root, "workers/public-content/publish.js", "export {};\n");
    writeFixture(
      root,
      ".next/server/middleware.js.nft.json",
      JSON.stringify({
        files: ["../../node_modules/@libsql/client/index.js"],
        version: 1,
      }),
    );
    writeFixture(
      root,
      ".next/server/instrumentation.js.nft.json",
      JSON.stringify({
        files: ["../../workers/public-content/publish.js"],
        version: 1,
      }),
    );

    const result = checkBuiltPublicDbBoundary({ rootDir: root });
    expect(result.contaminatedEntrypoints).toEqual([
      "instrumentation.ts",
      "proxy.ts",
    ]);
    expect(result.violations.map((violation) => violation.rule)).toContainAllValues([
      "libsql-client",
      "publisher-source",
    ]);
  });

  test("requires global compiled modules and trace evidence", () => {
    const missingModules = fixtureRoot();
    writeFixture(missingModules, "proxy.ts", "export default function proxy() {}\n");
    writeFixture(
      missingModules,
      "instrumentation.ts",
      "export function register() {}\n",
    );
    writeFixture(missingModules, ".next/server/app-paths-manifest.json", "{}");
    writeFixture(
      missingModules,
      ".next/server/middleware-manifest.json",
      JSON.stringify({
        functions: {},
        middleware: {},
        sortedMiddleware: [],
        version: 3,
      }),
    );
    expect(
      checkBuiltPublicDbBoundary({ rootDir: missingModules }).violations.map(
        (violation) => violation.rule,
      ),
    ).toEqual(["missing-build-module", "missing-build-module"]);

    const missingTraces = fixtureRoot();
    writeFixture(missingTraces, "proxy.ts", "export default function proxy() {}\n");
    writeFixture(
      missingTraces,
      "instrumentation.ts",
      "export function register() {}\n",
    );
    writeFixture(missingTraces, ".next/server/app-paths-manifest.json", "{}");
    writeFixture(
      missingTraces,
      ".next/server/middleware-manifest.json",
      JSON.stringify({
        functions: {},
        middleware: {},
        sortedMiddleware: [],
        version: 3,
      }),
    );
    writeBuildModule(missingTraces, "middleware.js");
    writeBuildModule(missingTraces, "instrumentation.js");
    expect(
      checkBuiltPublicDbBoundary({ rootDir: missingTraces }).violations.map(
        (violation) => violation.rule,
      ),
    ).toEqual(["missing-trace", "missing-trace"]);
  });

  test("validates every populated Edge middleware artifact before deferring content proof", () => {
    const valid = fixtureRoot();
    writeFixture(valid, "middleware.ts", "export default function middleware() {}\n");
    writeFixture(valid, ".next/server/app-paths-manifest.json", "{}");
    writeBuildModule(valid, "middleware.js");
    writeBuildModule(valid, "edge-runtime-webpack.js");
    writeFixture(
      valid,
      ".next/server/middleware-manifest.json",
      JSON.stringify({
        functions: {},
        middleware: {
          "/": {
            entrypoint: "server/middleware.js",
            files: ["server/edge-runtime-webpack.js", "server/middleware.js"],
            matchers: [],
            name: "middleware",
            page: "/",
          },
        },
        sortedMiddleware: ["/"],
        version: 3,
      }),
    );
    const validResult = checkBuiltPublicDbBoundary({ rootDir: valid });
    expect(validResult.ok).toBeFalse();
    expect(validResult.violations.map(({ rule }) => rule)).toEqual([
      "unverified-edge-content",
    ]);

    const stale = fixtureRoot();
    writeFixture(stale, "middleware.ts", "export default function middleware() {}\n");
    writeFixture(stale, ".next/server/app-paths-manifest.json", "{}");
    writeBuildModule(stale, "middleware.js");
    writeFixture(
      stale,
      ".next/server/middleware-manifest.json",
      JSON.stringify({
        functions: {},
        middleware: {
          "/": {
            entrypoint: "server/middleware.js",
            files: ["server/missing-edge-instrumentation.js"],
            matchers: [],
            name: "middleware",
            page: "/",
          },
        },
        sortedMiddleware: ["/"],
        version: 3,
      }),
    );
    expect(
      checkBuiltPublicDbBoundary({ rootDir: stale }).violations.map(
        (violation) => violation.rule,
      ),
    ).toContain("missing-build-module");

    const unrelated = fixtureRoot();
    writeFixture(
      unrelated,
      "middleware.ts",
      "export default function middleware() {}\n",
    );
    writeFixture(unrelated, ".next/server/app-paths-manifest.json", "{}");
    writeBuildModule(unrelated, "middleware.js");
    writeBuildModule(unrelated, "unrelated.js");
    writeFixture(
      unrelated,
      ".next/server/middleware-manifest.json",
      JSON.stringify({
        functions: {},
        middleware: {
          "/": {
            entrypoint: "server/unrelated.js",
            files: ["server/unrelated.js"],
            matchers: [],
            name: "middleware",
            page: "/",
          },
        },
        sortedMiddleware: ["/"],
        version: 3,
      }),
    );
    expect(
      checkBuiltPublicDbBoundary({ rootDir: unrelated }).violations.map(
        (violation) => violation.rule,
      ),
    ).toContain("missing-trace");
  });

  test("enforces Edge Turso env only for global and selected public definitions", () => {
    const root = fixtureRoot();
    writeFixture(root, "proxy.ts", "export default function proxy() {}\n");
    writeFixture(
      root,
      ".next/server/app-paths-manifest.json",
      JSON.stringify({ "/selected/route": "app/selected/route.js" }),
    );
    writeBuildModule(root, "app/selected/route.js");
    writeFixture(
      root,
      ".next/server/app/selected/route.js.nft.json",
      JSON.stringify({ files: [], version: 1 }),
    );
    writeBuildModule(root, "middleware.js");
    writeFixture(
      root,
      ".next/server/middleware.js.nft.json",
      JSON.stringify({ files: [], version: 1 }),
    );
    writeBuildModule(root, "edge.js");
    const edgeDefinition = (page: string) => ({
      entrypoint: "server/edge.js",
      env: { [tursoDatabaseUrlKey]: "value-must-never-be-logged" },
      files: ["server/edge.js"],
      matchers: [],
      name: page,
      page,
    });
    writeFixture(
      root,
      ".next/server/middleware-manifest.json",
      JSON.stringify({
        functions: {
          "/private/route": edgeDefinition("/private/route"),
          "/selected/route": edgeDefinition("/selected/route"),
        },
        middleware: { "/": edgeDefinition("/") },
        sortedMiddleware: ["/"],
        version: 3,
      }),
    );

    const result = checkBuiltPublicDbBoundary({
      appPaths: ["/selected/route"],
      rootDir: root,
    });
    const tursoViolations = result.violations.filter(
      (violation) => violation.rule === "turso-secret",
    );
    expect(tursoViolations).toHaveLength(2);
    expect(tursoViolations.map((violation) => violation.entrypoint)).toEqual([
      "/selected/route",
      "proxy.ts",
    ]);
    expect(JSON.stringify(tursoViolations)).not.toContain(
      "value-must-never-be-logged",
    );
  });


});
