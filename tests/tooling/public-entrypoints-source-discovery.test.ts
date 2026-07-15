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

describe("public source entrypoint discovery", () => {
  test("discovers generated metadata, route groups, slots and only GET handlers", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      "app/(marketing)/page.tsx",
      "export default function Page() {}\n",
    );
    writeFixture(
      root,
      "app/@modal/(.)photo/[id]/page.tsx",
      "export default function Photo() {}\n",
    );
    writeFixture(
      root,
      "app/api/read/route.ts",
      "export const GET = () => new Response();\n",
    );
    writeFixture(
      root,
      "app/api/head/route.ts",
      "export const HEAD = () => new Response();\n",
    );
    writeFixture(
      root,
      "app/api/reexport/route.ts",
      'export { handler as GET } from "./handler";\n',
    );
    writeFixture(
      root,
      "app/api/reexport/handler.ts",
      "export const handler = () => new Response();\n",
    );
    writeFixture(root, "app/api/star/route.ts", 'export * from "./handler";\n');
    writeFixture(
      root,
      "app/api/star/handler.ts",
      "export const GET = () => new Response();\n",
    );
    writeFixture(root, "app/api/write/route.ts", "export async function POST() {}\n");
    writeFixture(
      root,
      "app/not-found.tsx",
      "export default function NotFound() {}\n",
    );
    writeFixture(
      root,
      "app/robots.ts",
      "export default function robots() { return {}; }\n",
    );
    writeFixture(
      root,
      "app/sitemap.ts",
      "export default function sitemap() { return []; }\n",
    );

    expect(discoverSourceEntrypoints(root)).toEqual([
      {
        appPath: "/_not-found/page",
        kind: "page",
        methods: ["GET", "HEAD"],
        pathname: "/_not-found",
        representations: ["HTML", "RSC"],
        sourcePath: "app/not-found.tsx",
      },
      {
        appPath: "/(marketing)/page",
        kind: "page",
        methods: ["GET", "HEAD"],
        pathname: "/",
        representations: ["HTML", "RSC"],
        sourcePath: "app/(marketing)/page.tsx",
      },
      {
        appPath: "/@modal/(.)photo/[id]/page",
        kind: "page",
        methods: ["GET", "HEAD"],
        pathname: "/photo/[id]",
        representations: ["HTML", "RSC"],
        sourcePath: "app/@modal/(.)photo/[id]/page.tsx",
      },
      {
        appPath: "/api/head/route",
        kind: "route",
        methods: ["HEAD"],
        pathname: "/api/head",
        representations: [],
        sourcePath: "app/api/head/route.ts",
      },
      {
        appPath: "/api/read/route",
        kind: "route",
        methods: ["GET", "HEAD"],
        pathname: "/api/read",
        representations: [],
        sourcePath: "app/api/read/route.ts",
      },
      {
        appPath: "/api/reexport/route",
        kind: "route",
        methods: ["GET", "HEAD"],
        pathname: "/api/reexport",
        representations: [],
        sourcePath: "app/api/reexport/route.ts",
      },
      {
        appPath: "/api/star/route",
        kind: "route",
        methods: ["GET", "HEAD"],
        pathname: "/api/star",
        representations: [],
        sourcePath: "app/api/star/route.ts",
      },
      {
        appPath: "/robots.txt/route",
        kind: "route",
        methods: ["GET", "HEAD"],
        pathname: "/robots.txt",
        representations: [],
        sourcePath: "app/robots.ts",
      },
      {
        appPath: "/sitemap.xml/route",
        kind: "route",
        methods: ["GET", "HEAD"],
        pathname: "/sitemap.xml",
        representations: [],
        sourcePath: "app/sitemap.ts",
      },
    ]);
  });

  test("discovers runtime destructured handlers but ignores default and type-only exports", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      "app/api/object/route.ts",
      "const handlers = { GET: () => new Response() };\nexport const { GET } = handlers;\n",
    );
    writeFixture(
      root,
      "app/api/array/route.ts",
      "const handlers = [() => new Response()];\nexport const [HEAD] = handlers;\n",
    );
    writeFixture(
      root,
      "app/api/default/route.ts",
      "export default function GET() { return new Response(); }\n",
    );
    writeFixture(
      root,
      "app/api/type-only/route.ts",
      'export type { Handler as GET } from "./types";\nexport { type Handler as HEAD } from "./types";\n',
    );
    writeFixture(
      root,
      "app/api/type-only/types.ts",
      "export type Handler = () => Response;\n",
    );

    expect(
      discoverSourceEntrypoints(root).map(({ appPath, methods }) => ({
        appPath,
        methods,
      })),
    ).toEqual([
      { appPath: "/api/array/route", methods: ["HEAD"] },
      { appPath: "/api/object/route", methods: ["GET", "HEAD"] },
    ]);
  });

  test("discovers JSX route leaves and suppresses an exact POST-only build key", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      "app/api/read-tsx/route.tsx",
      "export const GET = () => new Response();\n",
    );
    writeFixture(
      root,
      "app/api/read-jsx/route.jsx",
      "export const GET = () => new Response();\n",
    );
    writeFixture(
      root,
      "app/api/write-tsx/route.tsx",
      "export const POST = () => new Response();\n",
    );

    const sourceEntrypoints = discoverSourceEntrypoints(root);
    const sourceRouteModules = discoverSourceRouteModules(root);
    expect(
      sourceEntrypoints.map(({ appPath, methods }) => ({ appPath, methods })),
    ).toEqual([
      { appPath: "/api/read-jsx/route", methods: ["GET", "HEAD"] },
      { appPath: "/api/read-tsx/route", methods: ["GET", "HEAD"] },
    ]);
    expect(sourceRouteModules).toEqual([
      {
        appPath: "/api/read-jsx/route",
        buildModule: "app/api/read-jsx/route.js",
        methods: ["GET", "HEAD"],
        sourcePath: "app/api/read-jsx/route.jsx",
      },
      {
        appPath: "/api/read-tsx/route",
        buildModule: "app/api/read-tsx/route.js",
        methods: ["GET", "HEAD"],
        sourcePath: "app/api/read-tsx/route.tsx",
      },
      {
        appPath: "/api/write-tsx/route",
        buildModule: "app/api/write-tsx/route.js",
        methods: [],
        sourcePath: "app/api/write-tsx/route.tsx",
      },
    ]);

    const validation = validateEntrypointInventory({
      sourceEntrypoints,
      sourceRouteModules,
      builtAppPaths: {
        "/api/read-jsx/route": "app/api/read-jsx/route.js",
        "/api/read-tsx/route": "app/api/read-tsx/route.js",
        "/api/write-tsx/route": "app/api/write-tsx/route.js",
      },
      inventory: [],
    });
    expect(validation.builtEntrypoints).toEqual([
      "/api/read-jsx/route",
      "/api/read-tsx/route",
    ]);
    expect(validation.unclassifiedBuild).toEqual([
      "/api/read-jsx/route",
      "/api/read-tsx/route",
    ]);
  });

  test("discovers every installed dynamic metadata source convention and generators", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      "app/manifest.ts",
      "export default function manifest() { return {}; }\n",
    );
    writeFixture(
      root,
      "app/blog/sitemap.ts",
      "export default function sitemap() { return []; }\n",
    );
    writeFixture(
      root,
      "app/catalog/sitemap.ts",
      "export function generateSitemaps() { return [{ id: 1 }]; }\nexport default function sitemap() { return []; }\n",
    );
    writeFixture(
      root,
      "app/icon.tsx",
      "export default function Icon() { return null; }\n",
    );
    writeFixture(
      root,
      "app/apple-icon.tsx",
      "export default function Icon() { return null; }\n",
    );
    writeFixture(
      root,
      "app/opengraph-image.tsx",
      "export function generateImageMetadata() { return [{ id: 1 }]; }\nexport default function Image() { return null; }\n",
    );
    writeFixture(
      root,
      "app/twitter-image.tsx",
      "export default function Image() { return null; }\n",
    );

    expect(
      discoverSourceEntrypoints(root).map(
        ({ appPath, pathname, sourcePath }) => ({ appPath, pathname, sourcePath }),
      ),
    ).toEqual([
      {
        appPath: "/apple-icon/route",
        pathname: "/apple-icon",
        sourcePath: "app/apple-icon.tsx",
      },
      {
        appPath: "/blog/sitemap.xml/route",
        pathname: "/blog/sitemap.xml",
        sourcePath: "app/blog/sitemap.ts",
      },
      {
        appPath: "/catalog/sitemap/[__metadata_id__]/route",
        pathname: "/catalog/sitemap/[__metadata_id__]",
        sourcePath: "app/catalog/sitemap.ts",
      },
      { appPath: "/icon/route", pathname: "/icon", sourcePath: "app/icon.tsx" },
      {
        appPath: "/manifest.webmanifest/route",
        pathname: "/manifest.webmanifest",
        sourcePath: "app/manifest.ts",
      },
      {
        appPath: "/opengraph-image/[__metadata_id__]/route",
        pathname: "/opengraph-image/[__metadata_id__]",
        sourcePath: "app/opengraph-image.tsx",
      },
      {
        appPath: "/twitter-image/route",
        pathname: "/twitter-image",
        sourcePath: "app/twitter-image.tsx",
      },
    ]);
  });

  test("fails closed when global and legacy not-found sources claim the same owner", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      "app/not-found.tsx",
      "export default function NotFound() {}\n",
    );
    writeFixture(
      root,
      "app/global-not-found.tsx",
      "export default function GlobalNotFound() {}\n",
    );

    const sourceEntrypoints = discoverSourceEntrypoints(root);
    expect(
      sourceEntrypoints.map(({ appPath, sourcePath }) => ({
        appPath,
        sourcePath,
      })),
    ).toEqual([
      {
        appPath: "/_not-found/page",
        sourcePath: "app/global-not-found.tsx",
      },
      { appPath: "/_not-found/page", sourcePath: "app/not-found.tsx" },
    ]);

    const validation = validateEntrypointInventory({
      builtAppPaths: { "/_not-found/page": "app/_not-found/page.js" },
      inventory: [],
      sourceEntrypoints,
      sourceRouteModules: [],
    });
    expect(validation.duplicateSourceAppPaths).toEqual(["/_not-found/page"]);
    expect(() => validation.assertComplete()).toThrow(/Duplicate source app paths/);
  });
});
