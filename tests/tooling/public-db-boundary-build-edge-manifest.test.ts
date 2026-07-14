import { afterEach, describe, expect, test } from "bun:test";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { checkBuiltPublicDbBoundary } from "@/scripts/ops/check-public-db-boundary";
import {
  cleanupFixtureRoots,
  fixtureRoot,
  writeBuildModule,
  writeFixture,
} from "./public-db-boundary-fixtures";

afterEach(cleanupFixtureRoots);

function emptyManifest(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    functions: {},
    middleware: {},
    sortedMiddleware: [],
    version: 3,
    ...overrides,
  });
}

describe("anonymous public DB boundary — Edge manifest authority", () => {
  test("requires middleware-manifest evidence for every valid Next build", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      ".next/server/app-paths-manifest.json",
      JSON.stringify({ "/public/page": "app/public/page.js" }),
    );
    writeFixture(root, ".next/server/app/public/page.js", "export {};\n");
    writeFixture(
      root,
      ".next/server/app/public/page.js.nft.json",
      JSON.stringify({ files: [], version: 1 }),
    );

    const result = checkBuiltPublicDbBoundary({ rootDir: root });
    expect(result.violations.map(({ rule }) => rule)).toEqual([
      "missing-manifest",
    ]);
    expect(result.violations[0]?.file).toBe(
      ".next/server/middleware-manifest.json",
    );
  });

  test("marks exact root Edge middleware unverified even without a source convention", () => {
    const root = fixtureRoot();
    writeFixture(root, ".next/server/app-paths-manifest.json", "{}");
    writeBuildModule(root, "middleware.js");
    writeFixture(
      root,
      ".next/server/middleware-manifest.json",
      emptyManifest({
        middleware: {
          "/": {
            entrypoint: "server/middleware.js",
            files: ["server/middleware.js"],
            page: "/",
          },
        },
        sortedMiddleware: ["/"],
      }),
    );

    const result = checkBuiltPublicDbBoundary({ rootDir: root });
    expect(result.violations.map(({ rule }) => rule)).toEqual([
      "unverified-edge-content",
    ]);
  });

  test("rejects non-root global middleware even when a pure NFT exists", () => {
    const root = fixtureRoot();
    writeFixture(root, ".next/server/app-paths-manifest.json", "{}");
    writeBuildModule(root, "middleware.js");
    writeFixture(
      root,
      ".next/server/middleware.js.nft.json",
      JSON.stringify({ files: [], version: 1 }),
    );
    writeFixture(
      root,
      ".next/server/middleware-manifest.json",
      emptyManifest({
        middleware: {
          "/foo": {
            entrypoint: "server/middleware.js",
            files: ["server/middleware.js"],
            page: "/foo",
          },
        },
        sortedMiddleware: ["/foo"],
      }),
    );

    const result = checkBuiltPublicDbBoundary({ rootDir: root });
    expect(result.violations.map(({ rule }) => rule)).toEqual([
      "malformed-manifest",
    ]);
  });

  test("rejects Windows drive-relative, drive-absolute and UNC artifact paths", () => {
    const root = fixtureRoot();
    writeFixture(root, ".next/server/app-paths-manifest.json", "{}");
    writeBuildModule(root, "middleware.js");
    writeFixture(
      root,
      ".next/server/middleware-manifest.json",
      emptyManifest({
        middleware: {
          "/": {
            entrypoint: "server/middleware.js",
            files: [
              "server/middleware.js",
              "C:relative.js",
              "C:\\absolute.js",
              "\\\\server\\share.js",
            ],
            page: "/",
          },
        },
        sortedMiddleware: ["/"],
      }),
    );

    const result = checkBuiltPublicDbBoundary({ rootDir: root });
    expect(
      result.violations.filter(({ rule }) => rule === "unsafe-manifest-path"),
    ).toHaveLength(3);
  });

  test("rejects a lexically safe manifest artifact symlink outside .next", () => {
    const root = fixtureRoot();
    writeFixture(root, ".next/server/app-paths-manifest.json", "{}");
    writeBuildModule(root, "middleware.js");
    writeFixture(root, "lib/outside.js", "export {};\n");
    symlinkSync(
      join(root, "lib/outside.js"),
      join(root, ".next/server/escaped.js"),
    );
    writeFixture(
      root,
      ".next/server/middleware-manifest.json",
      emptyManifest({
        middleware: {
          "/": {
            entrypoint: "server/middleware.js",
            files: ["server/escaped.js", "server/middleware.js"],
            page: "/",
          },
        },
        sortedMiddleware: ["/"],
      }),
    );

    const result = checkBuiltPublicDbBoundary({ rootDir: root });
    expect(result.violations.map(({ rule }) => rule)).toContain(
      "unsafe-manifest-path",
    );
  });

  test("validates every function against the full app manifest", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      ".next/server/app-paths-manifest.json",
      JSON.stringify({
        "/private/route": "app/private/route.js",
        "/selected/route": "app/selected/route.js",
      }),
    );
    writeBuildModule(root, "app/selected/route.js");
    writeFixture(
      root,
      ".next/server/app/selected/route.js.nft.json",
      JSON.stringify({ files: [], version: 1 }),
    );
    writeBuildModule(root, "app/unrelated/route.js");
    writeBuildModule(root, "app/rogue/route.js");
    writeFixture(
      root,
      ".next/server/middleware-manifest.json",
      emptyManifest({
        functions: {
          "/private/route": {
            entrypoint: "server/app/unrelated/route.js",
            files: ["server/app/unrelated/route.js"],
            page: "/private/route",
          },
          "/rogue/route": {
            entrypoint: "server/app/rogue/route.js",
            files: ["server/app/rogue/route.js"],
            page: "/rogue/route",
          },
        },
      }),
    );

    const result = checkBuiltPublicDbBoundary({
      appPaths: ["/selected/route"],
      rootDir: root,
    });
    expect(
      result.violations.filter(({ rule }) => rule === "malformed-manifest"),
    ).toHaveLength(2);
  });
});
