import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { checkBuiltPublicDbBoundary } from "@/scripts/ops/check-public-db-boundary";
import {
  cleanupFixtureRoots,
  fixtureRoot,
  writeBuildModule,
  writeFixture,
} from "./public-db-boundary-fixtures";

afterEach(cleanupFixtureRoots);

describe("anonymous public DB boundary — build traces", () => {
  test("flags libSQL in a synthetic Next output trace", () => {
    const root = fixtureRoot();
    writeBuildModule(root, "app/(public)/public/page.js");
    writeFixture(
      root,
      ".next/server/app/(public)/public/page.js.nft.json",
      JSON.stringify({
        version: 1,
        files: [
          "../../../../../node_modules/@libsql/client/lib-esm/node.js",
          "../../../chunks/public.js",
        ],
      }),
    );

    writeFixture(
      root,
      ".next/server/app-paths-manifest.json",
      JSON.stringify({ "/(public)/public/page": "app/(public)/public/page.js" }),
    );
    writeFixture(root, "node_modules/@libsql/client/lib-esm/node.js", "export {};\n");
    writeFixture(root, ".next/server/chunks/public.js", "export {};\n");

    const result = checkBuiltPublicDbBoundary({ rootDir: root });

    expect(result.ok).toBeFalse();
    expect(result.contaminatedEntrypoints).toEqual(["/(public)/public/page"]);
    expect(result.violations[0]?.rule).toBe("libsql-client");
  });

  test("fails closed for missing, malformed and escaping output traces", () => {
    const root = fixtureRoot();
    writeBuildModule(root, "app/missing/page.js");
    writeBuildModule(root, "app/malformed/page.js");
    writeFixture(
      root,
      ".next/server/app-paths-manifest.json",
      JSON.stringify({
        "/missing/page": "app/missing/page.js",
        "/malformed/page": "app/malformed/page.js",
        "/escape/page": "../../outside.js",
        "/windows-escape/page": "app\\..\\outside.js",
      }),
    );
    writeFixture(root, ".next/server/app/malformed/page.js.nft.json", "[]");

    const result = checkBuiltPublicDbBoundary({ rootDir: root });

    expect(result.ok).toBeFalse();
    const rules = result.violations.map((violation) => violation.rule);
    for (const expectedRule of [
      "missing-trace",
      "malformed-trace",
      "unsafe-manifest-path",
    ] as const) {
      expect(rules).toContain(expectedRule);
    }
    expect(
      result.violations.find(
        (violation) => violation.entrypoint === "/windows-escape/page",
      )?.rule,
    ).toBe("unsafe-manifest-path");
  });

  test("rejects every forbidden dependency class named by an output trace", () => {
    const root = fixtureRoot();
    writeBuildModule(root, "app/public/page.js");
    writeFixture(
      root,
      ".next/server/app-paths-manifest.json",
      JSON.stringify({ "/public/page": "app/public/page.js" }),
    );
    writeFixture(root, "db/client.js", "export {};\n");
    writeFixture(root, "lib/api/feed-results.ts", "export {};\n");
    writeFixture(root, "node_modules/drizzle-orm/index.js", "export {};\n");
    writeFixture(root, "lib/public-content/publisher/run.js", "export {};\n");
    writeFixture(
      root,
      ".next/server/app/public/page.js.nft.json",
      JSON.stringify({
        version: 1,
        files: [
          "../../../../db/client.js",
          "../../../../lib/api/feed-results.ts",
          "../../../../node_modules/drizzle-orm/index.js",
          "../../../../lib/public-content/publisher/run.js",
        ],
      }),
    );

    const result = checkBuiltPublicDbBoundary({ rootDir: root });
    expect(result.violations.map((violation) => violation.rule)).toContainAllValues([
      "db-source",
      "db-owning-loader",
      "drizzle-orm",
      "publisher-source",
    ]);
  });

  test("denies every libsql package family in output traces", () => {
    const root = fixtureRoot();
    writeBuildModule(root, "app/public/page.js");
    writeFixture(
      root,
      ".next/server/app-paths-manifest.json",
      JSON.stringify({ "/public/page": "app/public/page.js" }),
    );
    writeFixture(
      root,
      ".next/server/app/public/page.js.nft.json",
      JSON.stringify({
        version: 1,
        files: [
          "../../../../node_modules/@libsql/hrana-client/index.js",
          "../../../../node_modules/libsql/index.js",
        ],
      }),
    );
    writeFixture(root, "node_modules/@libsql/hrana-client/index.js", "export {};\n");
    writeFixture(root, "node_modules/libsql/index.js", "export {};\n");

    const result = checkBuiltPublicDbBoundary({ rootDir: root });
    expect(
      result.violations.filter((violation) => violation.rule === "libsql-client"),
    ).toHaveLength(1);
  });

  test("denies unscoped Turbopack libsql hash directories", () => {
    const root = fixtureRoot();
    writeBuildModule(root, "app/public/page.js");
    writeFixture(
      root,
      ".next/server/app-paths-manifest.json",
      JSON.stringify({ "/public/page": "app/public/page.js" }),
    );
    writeFixture(
      root,
      ".next/server/app/public/page.js.nft.json",
      JSON.stringify({
        version: 1,
        files: ["../../../../node_modules/libsql-deadbeef/index.js"],
      }),
    );
    writeFixture(root, "node_modules/libsql-deadbeef/index.js", "export {};\n");

    const result = checkBuiltPublicDbBoundary({ rootDir: root });
    expect(result.violations.map((violation) => violation.rule)).toContain(
      "libsql-client",
    );
  });

  test("requires NFT version 1 and every referenced dependency to exist", () => {
    const root = fixtureRoot();
    writeBuildModule(root, "app/missing/page.js");
    writeBuildModule(root, "app/version/page.js");
    writeFixture(
      root,
      ".next/server/app-paths-manifest.json",
      JSON.stringify({
        "/missing/page": "app/missing/page.js",
        "/version/page": "app/version/page.js",
      }),
    );
    writeFixture(
      root,
      ".next/server/app/missing/page.js.nft.json",
      JSON.stringify({ version: 1, files: ["../../../../lib/missing.js"] }),
    );
    writeFixture(
      root,
      ".next/server/app/version/page.js.nft.json",
      JSON.stringify({ version: 2, files: [] }),
    );

    const result = checkBuiltPublicDbBoundary({ rootDir: root });
    expect(result.violations.map((violation) => violation.rule)).toContainAllValues([
      "malformed-trace",
      "missing-trace-dependency",
    ]);
  });

  test("rejects physical NFT escapes but permits db directories inside external packages", () => {
    const root = fixtureRoot();
    writeBuildModule(root, "app/external/page.js");
    writeBuildModule(root, "app/escape/page.js");
    const externalRoot = fixtureRoot();
    const outsideFile = join(externalRoot, "outside.js");
    writeFixture(externalRoot, "outside.js", "export {};\n");
    mkdirSync(join(root, "lib"), { recursive: true });
    symlinkSync(outsideFile, join(root, "lib/escaped.js"));
    writeFixture(root, "node_modules/allowed/db/index.js", "export {};\n");
    writeFixture(
      root,
      ".next/server/app-paths-manifest.json",
      JSON.stringify({
        "/external/page": "app/external/page.js",
        "/escape/page": "app/escape/page.js",
      }),
    );
    writeFixture(
      root,
      ".next/server/app/external/page.js.nft.json",
      JSON.stringify({
        version: 1,
        files: ["../../../../node_modules/allowed/db/index.js"],
      }),
    );
    writeFixture(
      root,
      ".next/server/app/escape/page.js.nft.json",
      JSON.stringify({ version: 1, files: ["../../../../lib/escaped.js"] }),
    );

    const external = checkBuiltPublicDbBoundary({
      rootDir: root,
      appPaths: ["/external/page"],
    });
    expect(external.ok).toBeTrue();
    const escape = checkBuiltPublicDbBoundary({
      rootDir: root,
      appPaths: ["/escape/page"],
    });
    expect(escape.violations.map((violation) => violation.rule)).toContain(
      "unsafe-trace-path",
    );
  });

  test("rejects Windows drive and UNC absolute NFT dependencies on every host", () => {
    const root = fixtureRoot();
    writeBuildModule(root, "app/public/page.js");
    writeFixture(
      root,
      ".next/server/app-paths-manifest.json",
      JSON.stringify({ "/public/page": "app/public/page.js" }),
    );
    writeFixture(
      root,
      ".next/server/app/public/page.js.nft.json",
      JSON.stringify({
        files: ["C:\\outside.js", "\\\\server\\share\\outside.js"],
        version: 1,
      }),
    );
    // On POSIX, a drive-prefixed string can otherwise resolve beneath the
    // trace directory and look like a legitimate in-repo dependency.
    writeFixture(
      root,
      ".next/server/app/public/C:/outside.js",
      "export {};\n",
    );

    const result = checkBuiltPublicDbBoundary({ rootDir: root });
    expect(
      result.violations.filter(
        (violation) => violation.rule === "unsafe-trace-path",
      ),
    ).toHaveLength(2);
  });

});
