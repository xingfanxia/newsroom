import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { checkBuiltPublicDbBoundary } from "@/scripts/ops/check-public-db-boundary";
import {
  cleanupFixtureRoots,
  fixtureRoot,
  writeEmptyMiddlewareManifest,
  writeBuildModule,
  writeFixture,
} from "./public-db-boundary-fixtures";

afterEach(cleanupFixtureRoots);

describe("anonymous public DB boundary — build artifact validation", () => {
  test("rejects a missing compiled build module even when its NFT trace exists", () => {
    const root = fixtureRoot();
    writeEmptyMiddlewareManifest(root);
    writeFixture(
      root,
      ".next/server/app-paths-manifest.json",
      JSON.stringify({ "/public/page": "app/public/page.js" }),
    );
    writeFixture(
      root,
      ".next/server/app/public/page.js.nft.json",
      JSON.stringify({ version: 1, files: [] }),
    );

    const result = checkBuiltPublicDbBoundary({ rootDir: root });
    expect(result.ok).toBeFalse();
    expect(result.violations.map((violation) => violation.rule)).toEqual([
      "missing-build-module",
    ]);
  });

  test("requires compiled build modules to be regular files physically inside the server root", () => {
    const root = fixtureRoot();
    writeEmptyMiddlewareManifest(root);
    const externalRoot = fixtureRoot();
    const outsideModule = join(externalRoot, "page.js");
    writeFixture(externalRoot, "page.js", "export {};\n");
    writeFixture(
      root,
      ".next/server/app-paths-manifest.json",
      JSON.stringify({
        "/directory/page": "app/directory/page.js",
        "/escape/page": "app/escape/page.js",
      }),
    );
    mkdirSync(join(root, ".next/server/app/directory/page.js"), {
      recursive: true,
    });
    writeFixture(
      root,
      ".next/server/app/directory/page.js.nft.json",
      JSON.stringify({ version: 1, files: [] }),
    );
    mkdirSync(join(root, ".next/server/app/escape"), { recursive: true });
    symlinkSync(outsideModule, join(root, ".next/server/app/escape/page.js"));
    writeFixture(
      root,
      ".next/server/app/escape/page.js.nft.json",
      JSON.stringify({ version: 1, files: [] }),
    );

    const result = checkBuiltPublicDbBoundary({ rootDir: root });
    expect(result.violations.map((violation) => violation.rule)).toContainAllValues([
      "invalid-build-module",
      "unsafe-manifest-path",
    ]);
  });

  test("requires every traced dependency to be a regular file", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      ".next/server/app-paths-manifest.json",
      JSON.stringify({ "/public/page": "app/public/page.js" }),
    );
    writeBuildModule(root, "app/public/page.js");
    mkdirSync(join(root, "lib/directory"), { recursive: true });
    writeFixture(
      root,
      ".next/server/app/public/page.js.nft.json",
      JSON.stringify({
        version: 1,
        files: ["../../../../lib/directory"],
      }),
    );

    const result = checkBuiltPublicDbBoundary({ rootDir: root });
    expect(result.ok).toBeFalse();
    expect(result.violations.map((violation) => violation.rule)).toEqual([
      "invalid-trace-dependency",
    ]);
  });

  test("requires the NFT trace itself to be a regular file", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      ".next/server/app-paths-manifest.json",
      JSON.stringify({ "/public/page": "app/public/page.js" }),
    );
    writeBuildModule(root, "app/public/page.js");
    mkdirSync(join(root, ".next/server/app/public/page.js.nft.json"), {
      recursive: true,
    });

    const result = checkBuiltPublicDbBoundary({ rootDir: root });
    expect(result.violations.map((violation) => violation.rule)).toEqual([
      "invalid-trace",
    ]);
  });

  test("rejects an NFT trace symlink to unrelated JSON elsewhere in the repo", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      ".next/server/app-paths-manifest.json",
      JSON.stringify({ "/public/page": "app/public/page.js" }),
    );
    writeBuildModule(root, "app/public/page.js");
    writeFixture(
      root,
      "evidence/unrelated.json",
      JSON.stringify({ version: 1, files: [] }),
    );
    symlinkSync(
      join(root, "evidence/unrelated.json"),
      join(root, ".next/server/app/public/page.js.nft.json"),
    );

    const result = checkBuiltPublicDbBoundary({ rootDir: root });
    expect(result.ok).toBeFalse();
    expect(result.violations.map((violation) => violation.rule)).toEqual([
      "unsafe-trace-path",
    ]);
  });

  test("keeps a specific forbidden rule for Turbopack package directories", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      ".next/server/app-paths-manifest.json",
      JSON.stringify({ "/public/page": "app/public/page.js" }),
    );
    writeBuildModule(root, "app/public/page.js");
    mkdirSync(join(root, "node_modules/@libsql/client-deadbeef"), {
      recursive: true,
    });
    writeFixture(
      root,
      ".next/server/app/public/page.js.nft.json",
      JSON.stringify({
        version: 1,
        files: ["../../../../node_modules/@libsql/client-deadbeef"],
      }),
    );

    const result = checkBuiltPublicDbBoundary({ rootDir: root });
    expect(result.violations.map((violation) => violation.rule)).toEqual([
      "libsql-client",
    ]);
  });

  test("rejects public-content worker code in output traces", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      ".next/server/app-paths-manifest.json",
      JSON.stringify({ "/public/page": "app/public/page.js" }),
    );
    writeBuildModule(root, "app/public/page.js");
    writeFixture(root, "workers/public-content/publish.js", "export {};\n");
    writeFixture(
      root,
      ".next/server/app/public/page.js.nft.json",
      JSON.stringify({
        version: 1,
        files: ["../../../../workers/public-content/publish.js"],
      }),
    );

    const result = checkBuiltPublicDbBoundary({ rootDir: root });
    expect(result.violations.map((violation) => violation.rule)).toEqual([
      "publisher-source",
    ]);
  });

  test("uses a manifest-specific diagnostic when the manifest is unreadable", () => {
    const root = fixtureRoot();
    writeFixture(root, ".next/server/app-paths-manifest.json", "[]");
    expect(
      checkBuiltPublicDbBoundary({ rootDir: root }).violations.map(
        (violation) => violation.rule,
      ),
    ).toEqual(["malformed-manifest"]);
  });

  test("reports a missing manifest before attempting to parse it", () => {
    const root = fixtureRoot();
    expect(
      checkBuiltPublicDbBoundary({ rootDir: root }).violations.map(
        (violation) => violation.rule,
      ),
    ).toEqual(["missing-manifest"]);
  });

  test("rejects a manifest path that is not a regular file", () => {
    const root = fixtureRoot();
    mkdirSync(join(root, ".next/server/app-paths-manifest.json"), {
      recursive: true,
    });
    expect(
      checkBuiltPublicDbBoundary({ rootDir: root }).violations.map(
        (violation) => violation.rule,
      ),
    ).toEqual(["invalid-manifest"]);
  });

  test("rejects a manifest symlink that physically escapes the server root", () => {
    const root = fixtureRoot();
    const externalRoot = fixtureRoot();
    writeFixture(externalRoot, "manifest.json", "{}");
    mkdirSync(join(root, ".next/server"), { recursive: true });
    symlinkSync(
      join(externalRoot, "manifest.json"),
      join(root, ".next/server/app-paths-manifest.json"),
    );

    const result = checkBuiltPublicDbBoundary({ rootDir: root });
    expect(result.ok).toBeFalse();
    expect(result.violations.map((violation) => violation.rule)).toEqual([
      "unsafe-manifest-path",
    ]);
  });
});
