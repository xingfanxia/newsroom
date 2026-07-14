import { afterEach, describe, expect, test } from "bun:test";
import { checkBuiltPublicDbBoundary } from "@/scripts/ops/check-public-db-boundary";
import {
  cleanupFixtureRoots,
  fixtureRoot,
  writeBuildModule,
  writeFixture,
} from "./public-db-boundary-fixtures";

afterEach(cleanupFixtureRoots);

describe("anonymous public DB boundary — Edge instrumentation", () => {
  test("keeps manifest-only Edge instrumentation explicitly unverified", () => {
    const root = fixtureRoot();
    writeFixture(root, "instrumentation.ts", "export function register() {}\n");
    writeFixture(root, ".next/server/app-paths-manifest.json", "{}");
    writeBuildModule(root, "edge-instrumentation.js");
    writeFixture(
      root,
      ".next/server/middleware-manifest.json",
      JSON.stringify({
        functions: {},
        instrumentation: { files: ["server/edge-instrumentation.js"] },
        middleware: {},
        sortedMiddleware: [],
        version: 3,
      }),
    );

    const result = checkBuiltPublicDbBoundary({ rootDir: root });
    expect(result.ok).toBeFalse();
    expect(result.violations.map(({ rule }) => rule)).toEqual([
      "unverified-edge-content",
    ]);
  });
});
