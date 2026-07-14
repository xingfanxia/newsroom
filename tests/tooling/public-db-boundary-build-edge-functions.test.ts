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

describe("anonymous public DB boundary — Edge functions", () => {
  test("validates selected Edge functions without a global convention source", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      ".next/server/app-paths-manifest.json",
      JSON.stringify({ "/api/edge/route": "app/api/edge/route.js" }),
    );
    writeBuildModule(root, "app/api/edge/route.js");
    writeFixture(root, ".next/required-server-files.js", "export {};\n");
    writeFixture(
      root,
      ".next/server/app/api/edge/route.js.nft.json",
      JSON.stringify({ files: [], version: 1 }),
    );
    writeFixture(
      root,
      ".next/server/middleware-manifest.json",
      JSON.stringify({
        functions: {
          "/api/edge/route": {
            entrypoint: "server/app/api/edge/route.js",
            env: { [tursoDatabaseUrlKey]: "secret-token" },
            files: ["server/app/api/edge/route.js"],
            page: "/api/edge/route",
          },
        },
        middleware: {},
        sortedMiddleware: [],
        version: 3,
      }),
    );

    const result = checkBuiltPublicDbBoundary({
      appPaths: ["/api/edge/route"],
      rootDir: root,
    });

    expect(result.ok).toBeFalse();
    expect(result.violations.map(({ rule }) => rule)).toContain("turso-secret");
    expect(result.violations.map(({ rule }) => rule)).toContain(
      "unverified-edge-content",
    );
    expect(JSON.stringify(result.violations)).not.toContain("secret-token");
  });

  test("marks an exact NFT-less selected Edge function explicitly unverified", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      ".next/server/app-paths-manifest.json",
      JSON.stringify({ "/api/edge/route": "app/api/edge/route.js" }),
    );
    writeBuildModule(root, "app/api/edge/route.js");
    writeFixture(root, ".next/required-server-files.js", "export {};\n");
    writeFixture(
      root,
      ".next/server/middleware-manifest.json",
      JSON.stringify({
        functions: {
          "/api/edge/route": {
            entrypoint: "server/app/api/edge/route.js",
            files: [
              "required-server-files.js",
              "server/app/api/edge/route.js",
            ],
            page: "/api/edge/route",
          },
        },
        middleware: {},
        sortedMiddleware: [],
        version: 3,
      }),
    );

    const result = checkBuiltPublicDbBoundary({
      appPaths: ["/api/edge/route"],
      rootDir: root,
    });

    expect(result.ok).toBeFalse();
    expect(result.violations.map(({ rule }) => rule)).toEqual([
      "unverified-edge-content",
    ]);
    expect(result.violations.map(({ rule }) => rule)).not.toContain(
      "missing-trace",
    );
    expect(result.visitedFiles).toContain(
      ".next/server/app/api/edge/route.js.nft.json",
    );
  });

  test("rejects selected Edge evidence bound to another artifact even with an NFT", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      ".next/server/app-paths-manifest.json",
      JSON.stringify({ "/api/edge/route": "app/api/edge/route.js" }),
    );
    writeBuildModule(root, "app/api/edge/route.js");
    writeFixture(
      root,
      ".next/server/app/api/edge/route.js.nft.json",
      JSON.stringify({ files: [], version: 1 }),
    );
    writeBuildModule(root, "app/api/unrelated/route.js");
    writeFixture(
      root,
      ".next/server/middleware-manifest.json",
      JSON.stringify({
        functions: {
          "/api/edge/route": {
            entrypoint: "server/app/api/unrelated/route.js",
            files: ["server/app/api/unrelated/route.js"],
            page: "/api/edge/route",
          },
        },
        middleware: {},
        sortedMiddleware: [],
        version: 3,
      }),
    );

    const result = checkBuiltPublicDbBoundary({
      appPaths: ["/api/edge/route"],
      rootDir: root,
    });

    expect(result.ok).toBeFalse();
    expect(result.violations.map(({ rule }) => rule)).toContain(
      "malformed-manifest",
    );
  });
});
