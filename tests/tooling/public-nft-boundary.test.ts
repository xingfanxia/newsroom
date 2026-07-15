import { afterEach, describe, expect, test } from "bun:test";
import { defineServingEntrypoint } from "@/lib/public-content/entrypoints";
import { checkPublicNftBoundary } from "@/scripts/verification/check-public-nft";
import {
  cleanupFixtureRoots,
  fixtureRoot,
  writeBuildModule,
  writeFixture,
} from "./public-db-boundary-fixtures";

afterEach(cleanupFixtureRoots);

const entrypoint = defineServingEntrypoint({
  access: "snapshot-only",
  appPath: "/public/page",
  kind: "page",
  pathname: "/public",
  sourcePath: "app/public/page.tsx",
});

function writePublicBuild(root: string, chunkSource = "export {};\n"): void {
  writeBuildModule(root, "app/public/page.js");
  writeFixture(
    root,
    ".next/server/app-paths-manifest.json",
    JSON.stringify({ "/public/page": "app/public/page.js" }),
  );
  writeFixture(root, ".next/server/chunks/public.js", chunkSource);
  writeFixture(
    root,
    ".next/server/app/public/page.js.nft.json",
    JSON.stringify({
      files: ["../../chunks/public.js"],
      version: 1,
    }),
  );
}

describe("authoritative public NFT and compiled-byte boundary", () => {
  test("accepts a clean traced server bundle", () => {
    const root = fixtureRoot();
    writePublicBuild(root);
    expect(
      checkPublicNftBoundary({ entrypoints: [entrypoint], rootDir: root }).ok,
    ).toBeTrue();
  });

  test("rejects an inlined Turso marker even when the NFT path is innocent", () => {
    const root = fixtureRoot();
    writePublicBuild(root, 'export const key = "TURSO_DATABASE_URL";\n');
    const result = checkPublicNftBoundary({
      entrypoints: [entrypoint],
      rootDir: root,
    });
    expect(result.ok).toBeFalse();
    expect(result.violations.map(({ rule }) => rule)).toContain("turso-secret");
    expect(result.contaminatedEntrypoints).toEqual(["/public/page"]);
  });

  test("rejects a DB client hidden in an anonymous browser chunk", () => {
    const root = fixtureRoot();
    writePublicBuild(root);
    writeFixture(
      root,
      ".next/server/app/public/page_client-reference-manifest.js",
      'globalThis.manifest={chunks:["/_next/static/chunks/public.js"]};\n',
    );
    writeFixture(
      root,
      ".next/static/chunks/public.js",
      'export const driver = "@libsql/client";\n',
    );
    const result = checkPublicNftBoundary({
      entrypoints: [entrypoint],
      rootDir: root,
    });
    expect(result.violations.map(({ rule }) => rule)).toContain("libsql-client");
    expect(result.violations.some(({ file }) => file.endsWith("public.js"))).toBeTrue();
  });

  test("keeps the existing NFT path guard as independent evidence", () => {
    const root = fixtureRoot();
    writePublicBuild(root);
    writeFixture(root, "node_modules/@libsql/client/index.js", "export {};\n");
    writeFixture(
      root,
      ".next/server/app/public/page.js.nft.json",
      JSON.stringify({
        files: ["../../../../node_modules/@libsql/client/index.js"],
        version: 1,
      }),
    );
    const result = checkPublicNftBoundary({
      entrypoints: [entrypoint],
      rootDir: root,
    });
    expect(result.violations.map(({ rule }) => rule)).toContain("libsql-client");
  });
});
