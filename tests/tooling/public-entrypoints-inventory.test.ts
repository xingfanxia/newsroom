import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  defineServingEntrypoint,
  PUBLIC_SERVING_ENTRYPOINTS,
  SNAPSHOT_ONLY_ENTRYPOINTS,
  servingSurfacesFor,
} from "@/lib/public-content/entrypoints";
import {
  discoverSourceEntrypoints,
  discoverSourceRouteModules,
  readAppPathsManifest,
  validateEntrypointInventory,
} from "@/scripts/verification/discover-public-entrypoints";
import {
  cleanupFixtures,
  fixtureRoot,
  writeFixture,
} from "./public-entrypoints-fixtures";

afterEach(cleanupFixtures);

describe("public serving entrypoint inventory", () => {
  test("freezes the approved 24 snapshot-only readers and all access classes", () => {
    expect(SNAPSHOT_ONLY_ENTRYPOINTS).toHaveLength(24);
    expect(PUBLIC_SERVING_ENTRYPOINTS).toHaveLength(67);

    const counts = Object.groupBy(
      PUBLIC_SERVING_ENTRYPOINTS,
      (entrypoint) => entrypoint.access,
    );
    expect(counts["snapshot-only"]).toHaveLength(24);
    expect(counts["static-public"]).toHaveLength(7);
    expect(counts["private-authenticated"]).toHaveLength(23);
    expect(counts["operator-authenticated"]).toHaveLength(13);

    const snapshotPaths = SNAPSHOT_ONLY_ENTRYPOINTS.map(
      (entrypoint) => entrypoint.appPath,
    );
    expect(snapshotPaths).toContain("/[locale]/agents/page");
    expect(snapshotPaths).toContain("/api/feed/newsletter/[locale]/rss.xml/route");
    expect(snapshotPaths).toContain("/api/events/[id]/members/route");
    expect(snapshotPaths).toContain("/api/sources/active/route");
    expect(PUBLIC_SERVING_ENTRYPOINTS.map(({ appPath }) => appPath)).toContain(
      "/api/cron/publish-public/route",
    );
  });

  test("GET readers imply HEAD and pages imply both HTML and RSC", () => {
    expect(servingSurfacesFor("route")).toEqual(["GET", "HEAD"]);
    expect(servingSurfacesFor("page")).toEqual(["GET", "HEAD", "HTML", "RSC"]);

    for (const entrypoint of PUBLIC_SERVING_ENTRYPOINTS) {
      expect(entrypoint.surfaces).toContain("GET");
      expect(entrypoint.surfaces).toContain("HEAD");
      if (entrypoint.kind === "page") {
        expect(entrypoint.surfaces).toContain("HTML");
        expect(entrypoint.surfaces).toContain("RSC");
      }
    }
  });

  test("allows an explicit HEAD-only inventory contract", () => {
    const headOnly = defineServingEntrypoint({
      access: "static-public",
      appPath: "/health/route",
      buildModule: "app/health/route.js",
      kind: "route",
      methods: ["HEAD"],
      pathname: "/health",
      sourcePath: "app/health/route.ts",
    });
    expect(headOnly.methods).toEqual(["HEAD"]);
    expect(headOnly.surfaces).toEqual(["HEAD"]);
  });

  test("classifies every current source page/GET and every built page/GET", () => {
    const root = fixtureRoot();
    const manifestPath = join(root, ".next/server/app-paths-manifest.json");
    writeFixture(
      root,
      ".next/server/app-paths-manifest.json",
      JSON.stringify(
        Object.fromEntries(
          PUBLIC_SERVING_ENTRYPOINTS.map((entrypoint) => [
            entrypoint.appPath,
            entrypoint.buildModule,
          ]),
        ),
      ),
    );
    const result = validateEntrypointInventory({
      sourceEntrypoints: discoverSourceEntrypoints(process.cwd()),
      sourceRouteModules: discoverSourceRouteModules(process.cwd()),
      builtAppPaths: readAppPathsManifest(manifestPath),
      inventory: PUBLIC_SERVING_ENTRYPOINTS,
    });

    expect(result.sourceEntrypoints).toHaveLength(66);
    expect(result.builtEntrypoints).toHaveLength(67);
    expect(result.unclassifiedSource).toEqual([]);
    expect(result.unclassifiedBuild).toEqual([]);
    expect(result.missingFromBuild).toEqual([]);
  });

  test("rejects missing or malformed app-path manifests", () => {
    const root = fixtureRoot();
    expect(() => readAppPathsManifest(join(root, "missing.json"))).toThrow(
      /Unable to read App Router manifest/,
    );
    writeFixture(root, "manifest.json", "[]");
    expect(() => readAppPathsManifest(join(root, "manifest.json"))).toThrow(
      /must be an object/,
    );
    writeFixture(root, "manifest.json", '{"/page":42}');
    expect(() => readAppPathsManifest(join(root, "manifest.json"))).toThrow(
      /string module paths/,
    );
  });

  test("fails closed when a synthetic page or GET has no classification", () => {
    const root = fixtureRoot();
    writeFixture(root, "app/new/page.tsx", "export default function Page() {}\n");
    writeFixture(root, "app/api/new/route.ts", "export async function GET() {}\n");

    const result = validateEntrypointInventory({
      sourceEntrypoints: discoverSourceEntrypoints(root),
      sourceRouteModules: discoverSourceRouteModules(root),
      builtAppPaths: {
        "/new/page": "app/new/page.js",
        "/api/new/route": "app/api/new/route.js",
      },
      inventory: [],
    });

    expect(result.unclassifiedSource).toEqual(["/api/new/route", "/new/page"]);
    expect(result.unclassifiedBuild).toEqual(["/api/new/route", "/new/page"]);
    expect(() => result.assertComplete()).toThrow(
      /Unclassified source: \/api\/new\/route, \/new\/page/,
    );
  });

  test("distinguishes POST-only route bundles from stale unclassified routes", () => {
    const result = validateEntrypointInventory({
      sourceEntrypoints: [],
      sourceRouteModules: [
        {
          appPath: "/api/write/route",
          buildModule: "app/api/write/route.js",
          methods: [],
          sourcePath: "app/api/write/route.ts",
        },
      ],
      builtAppPaths: {
        "/api/stale/route": "app/api/stale/route.js",
        "/api/write/route": "app/api/write/route.js",
      },
      inventory: [],
    });

    expect(result.builtEntrypoints).toEqual(["/api/stale/route"]);
    expect(result.unclassifiedBuild).toEqual(["/api/stale/route"]);
  });

  test("suppresses only the exact proven POST-only raw app path and build module", () => {
    const result = validateEntrypointInventory({
      sourceEntrypoints: [],
      sourceRouteModules: [
        {
          appPath: "/api/write/route",
          buildModule: "app/api/shared/route.js",
          methods: [],
          sourcePath: "app/api/write/route.ts",
        },
      ],
      builtAppPaths: {
        "/api/stale/route": "app/api/shared/route.js",
        "/api/write/route": "app/api/shared/route.js",
      },
      inventory: [],
    });

    expect(result.builtEntrypoints).toEqual(["/api/stale/route"]);
    expect(result.unclassifiedBuild).toEqual(["/api/stale/route"]);
  });

  test("reports duplicate raw app paths before map construction can hide them", () => {
    const expected = PUBLIC_SERVING_ENTRYPOINTS.find(
      (entrypoint) => entrypoint.appPath === "/[locale]/login/page",
    );
    if (!expected) throw new Error("login inventory fixture is missing");
    const source = {
      appPath: expected.appPath,
      kind: expected.kind,
      methods: expected.methods,
      pathname: expected.pathname,
      representations: expected.representations,
      sourcePath: expected.sourcePath as string,
    };
    const result = validateEntrypointInventory({
      sourceEntrypoints: [source, source],
      sourceRouteModules: [],
      builtAppPaths: { [expected.appPath]: expected.buildModule },
      inventory: [expected, expected],
    });

    expect(result.duplicateInventoryAppPaths).toEqual([expected.appPath]);
    expect(result.duplicateSourceAppPaths).toEqual([expected.appPath]);
    expect(() => result.assertComplete()).toThrow(/Duplicate inventory app paths/);
  });

  test("fails when an inventoried source is absent or its method contract drifts", () => {
    const expected = PUBLIC_SERVING_ENTRYPOINTS.find(
      (entrypoint) => entrypoint.appPath === "/[locale]/login/page",
    );
    if (!expected) throw new Error("login inventory fixture is missing");

    const missing = validateEntrypointInventory({
      sourceEntrypoints: [],
      sourceRouteModules: [],
      builtAppPaths: { [expected.appPath]: expected.buildModule },
      inventory: [expected],
    });
    expect(missing.missingFromSource).toEqual([expected.appPath]);

    const drifted = validateEntrypointInventory({
      sourceEntrypoints: [
        {
          appPath: expected.appPath,
          kind: expected.kind,
          methods: ["HEAD"],
          pathname: expected.pathname,
          representations: expected.representations,
          sourcePath: expected.sourcePath as string,
        },
      ],
      sourceRouteModules: [],
      builtAppPaths: { [expected.appPath]: expected.buildModule },
      inventory: [expected],
    });
    expect(drifted.mismatchedSourceContracts).toEqual([expected.appPath]);
  });
});
