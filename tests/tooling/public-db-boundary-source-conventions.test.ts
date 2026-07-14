import { afterEach, describe, expect, test } from "bun:test";
import { checkSourcePublicDbBoundary } from "@/scripts/ops/check-public-db-boundary";
import {
  cleanupFixtureRoots,
  fixtureRoot,
  tursoDatabaseUrlKey,
  writeFixture,
} from "./public-db-boundary-fixtures";

afterEach(cleanupFixtureRoots);

describe("anonymous public DB boundary — source conventions", () => {
  test("rejects a synthetic transitive DB import with its complete chain", () => {
    const root = fixtureRoot();
    writeFixture(root, "app/public/page.tsx", 'import { view } from "@/lib/view";\nexport default view;\n');
    writeFixture(root, "lib/view.ts", 'export { load } from "@/lib/load";\nexport const view = load;\n');
    writeFixture(root, "lib/load.ts", 'import { db } from "@/db/client";\nexport const load = db;\n');
    writeFixture(root, "db/client.ts", 'import { createClient } from "@libsql/client";\nexport const db = createClient({ url: "file:test" });\n');

    const result = checkSourcePublicDbBoundary({
      rootDir: root,
      entrypointSources: ["app/public/page.tsx"],
    });

    expect(result.ok).toBeFalse();
    expect(result.contaminatedEntrypoints).toEqual(["app/public/page.tsx"]);
    expect(result.violations.some((violation) => violation.rule === "db-source")).toBeTrue();
    expect(result.violations.some((violation) => violation.rule === "libsql-client")).toBeTrue();
    expect(result.violations[0]?.importChain).toEqual([
      "app/public/page.tsx",
      "lib/view.ts",
      "lib/load.ts",
      "db/client.ts",
    ]);
  });

  test("passes a pure graph and ignores a type-only edge only after proving it pure", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      "app/public/page.tsx",
      'import type { PublicItem } from "@/lib/types";\nimport { render } from "@/lib/render";\nexport default function Page(): PublicItem { return render(); }\n',
    );
    writeFixture(root, "lib/types.ts", "export interface PublicItem { id: string }\n");
    writeFixture(root, "lib/render.ts", 'import type { PublicItem } from "./types";\nexport const render = (): PublicItem => ({ id: "ok" });\n');

    const result = checkSourcePublicDbBoundary({
      rootDir: root,
      entrypointSources: ["app/public/page.tsx"],
    });

    expect(result.ok).toBeTrue();
    expect(result.violations).toEqual([]);
    expect(result.visitedFiles).toEqual([
      "app/public/page.tsx",
      "lib/render.ts",
      "lib/types.ts",
    ]);
  });

  test("does not recurse into allowed external packages", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      "app/public/page.tsx",
      'import { render } from "allowed-package";\nexport default render;\n',
    );
    writeFixture(
      root,
      "node_modules/allowed-package/package.json",
      JSON.stringify({ name: "allowed-package", types: "index.d.ts" }),
    );
    writeFixture(
      root,
      "node_modules/allowed-package/index.d.ts",
      `// ${tursoDatabaseUrlKey} belongs to an external package, not our graph.\nexport declare const render: () => null;\n`,
    );

    const result = checkSourcePublicDbBoundary({
      rootDir: root,
      entrypointSources: ["app/public/page.tsx"],
    });

    expect(result.ok).toBeTrue();
    expect(result.visitedFiles).toEqual(["app/public/page.tsx"]);
  });

  test("rejects an impure type-only target, publisher code and Turso secret names", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      "app/public/page.tsx",
      'import type { Row } from "@/lib/public-types";\nimport { publish } from "@/lib/public-content/publisher/run";\nexport default function Page(): Row { return publish(); }\n',
    );
    writeFixture(
      root,
      "lib/public-types.ts",
      'export type { Row } from "@/lib/private-types";\n',
    );
    writeFixture(
      root,
      "lib/private-types.ts",
      'import type { DbRow } from "@/db/schema";\nexport type Row = DbRow;\n',
    );
    writeFixture(root, "db/schema.ts", "export interface DbRow { id: string }\n");
    writeFixture(
      root,
      "lib/public-content/publisher/run.ts",
      `export const publish = () => process.env.${tursoDatabaseUrlKey} as never;\n`,
    );

    const result = checkSourcePublicDbBoundary({
      rootDir: root,
      entrypointSources: ["app/public/page.tsx"],
    });

    expect(result.ok).toBeFalse();
    expect(result.violations.map((violation) => violation.rule)).toContainAllValues([
      "db-source",
      "publisher-source",
      "turso-secret",
    ]);
  });

  test("includes executable Next page ancestors and root proxy in the graph", () => {
    const root = fixtureRoot();
    writeFixture(root, "app/layout.tsx", "export default function Layout({ children }: { children: unknown }) { return children; }\n");
    writeFixture(root, "app/(public)/layout.tsx", "export default function Layout({ children }: { children: unknown }) { return children; }\n");
    writeFixture(root, "app/(public)/template.tsx", 'import { db } from "@/db/client";\nexport default function Template({ children }: { children: unknown }) { db; return children; }\n');
    writeFixture(root, "app/(public)/error.tsx", "export default function Error() { return null; }\n");
    writeFixture(root, "app/(public)/loading.tsx", "export default function Loading() { return null; }\n");
    writeFixture(root, "app/(public)/not-found.tsx", "export default function NotFound() { return null; }\n");
    writeFixture(root, "app/(public)/default.tsx", "export default function Default() { return null; }\n");
    writeFixture(root, "app/(public)/news/page.tsx", "export default function Page() { return null; }\n");
    writeFixture(root, "proxy.ts", 'import { identity } from "@/lib/identity";\nexport default identity;\n');
    writeFixture(root, "lib/identity.ts", "export const identity = () => {};\n");
    writeFixture(root, "db/client.ts", "export const db = {};\n");

    const result = checkSourcePublicDbBoundary({
      rootDir: root,
      entrypointSources: ["app/(public)/news/page.tsx"],
    });

    expect(result.ok).toBeFalse();
    expect(result.violations[0]?.importChain).toEqual([
      "app/(public)/news/page.tsx",
      "app/(public)/template.tsx",
      "db/client.ts",
    ]);
    expect(result.visitedFiles).not.toContain("app/(public)/default.tsx");
    for (const implicitSource of [
      "app/(public)/error.tsx",
      "app/(public)/loading.tsx",
      "app/(public)/not-found.tsx",
      "app/(public)/template.tsx",
      "app/layout.tsx",
      "proxy.ts",
    ]) {
      expect(result.visitedFiles).toContain(implicitSource);
    }
  });

  test("includes deprecated root middleware and src instrumentation in every public graph", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      "app/public/page.tsx",
      "export default function Page() { return null; }\n",
    );
    writeFixture(
      root,
      "middleware.ts",
      'import { middlewareDb } from "@/db/middleware";\nexport default middlewareDb;\n',
    );
    writeFixture(
      root,
      "src/instrumentation.ts",
      'import { instrumentationDb } from "@/db/instrumentation";\nexport function register() { instrumentationDb; }\n',
    );
    writeFixture(
      root,
      "instrumentation-client.ts",
      'import { clientDb } from "@/db/instrumentation-client";\nvoid clientDb;\n',
    );
    writeFixture(root, "db/middleware.ts", "export const middlewareDb = {};\n");
    writeFixture(
      root,
      "db/instrumentation.ts",
      "export const instrumentationDb = {};\n",
    );
    writeFixture(
      root,
      "db/instrumentation-client.ts",
      "export const clientDb = {};\n",
    );

    const result = checkSourcePublicDbBoundary({
      rootDir: root,
      entrypointSources: ["app/public/page.tsx"],
    });

    expect(result.ok).toBeFalse();
    for (const source of [
      "instrumentation-client.ts",
      "middleware.ts",
      "src/instrumentation.ts",
    ]) {
      expect(result.visitedFiles).toContain(source);
    }
    expect(
      result.violations.filter((violation) => violation.rule === "db-source"),
    ).toHaveLength(3);
  });

  test("includes app global-not-found in every public page graph", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      "app/public/page.tsx",
      "export default function Page() { return null; }\n",
    );
    writeFixture(
      root,
      "app/global-not-found.tsx",
      'import { db } from "@/db/client";\nexport default function GlobalNotFound() { db; return null; }\n',
    );
    writeFixture(root, "db/client.ts", "export const db = {};\n");

    const result = checkSourcePublicDbBoundary({
      rootDir: root,
      entrypointSources: ["app/public/page.tsx"],
    });

    expect(result.visitedFiles).toContain("app/global-not-found.tsx");
    expect(result.violations.map((violation) => violation.rule)).toContain(
      "db-source",
    );
  });

  test("includes a src proxy as a global request root", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      "app/public/page.tsx",
      "export default function Page() { return null; }\n",
    );
    writeFixture(
      root,
      "src/proxy.ts",
      'import { db } from "@/db/client";\nexport default function proxy() { db; }\n',
    );
    writeFixture(root, "db/client.ts", "export const db = {};\n");

    const result = checkSourcePublicDbBoundary({
      rootDir: root,
      entrypointSources: ["app/public/page.tsx"],
    });

    expect(result.visitedFiles).toContain("src/proxy.ts");
    expect(result.violations.map((violation) => violation.rule)).toContain(
      "db-source",
    );
  });

  test("scans every instrumentation-client JavaScript extension candidate", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      "app/public/page.tsx",
      "export default function Page() { return null; }\n",
    );
    writeFixture(root, "instrumentation-client.tsx", "void 0;\n");
    writeFixture(
      root,
      "instrumentation-client.js",
      'import { jsDb } from "@/db/client-js";\nvoid jsDb;\n',
    );
    writeFixture(
      root,
      "instrumentation-client.mjs",
      'import { mjsDb } from "@/db/client-mjs";\nvoid mjsDb;\n',
    );
    writeFixture(root, "db/client-js.ts", "export const jsDb = {};\n");
    writeFixture(root, "db/client-mjs.ts", "export const mjsDb = {};\n");

    const result = checkSourcePublicDbBoundary({
      rootDir: root,
      entrypointSources: ["app/public/page.tsx"],
    });

    for (const source of [
      "instrumentation-client.js",
      "instrumentation-client.mjs",
      "instrumentation-client.tsx",
    ]) {
      expect(result.visitedFiles).toContain(source);
    }
    expect(
      result.violations.filter((violation) => violation.rule === "db-source"),
    ).toHaveLength(2);
  });

  test("includes forbidden and unauthorized Next page boundaries", () => {
    const root = fixtureRoot();
    writeFixture(root, "app/layout.tsx", "export default function Layout({ children }: { children: unknown }) { return children; }\n");
    writeFixture(root, "app/public/forbidden.tsx", 'import { db } from "@/db/client";\nexport default function Forbidden() { db; return null; }\n');
    writeFixture(root, "app/public/unauthorized.tsx", "export default function Unauthorized() { return null; }\n");
    writeFixture(root, "app/public/page.tsx", "export default function Page() { return null; }\n");
    writeFixture(root, "db/client.ts", "export const db = {};\n");

    const result = checkSourcePublicDbBoundary({
      rootDir: root,
      entrypointSources: ["app/public/page.tsx"],
    });

    expect(result.ok).toBeFalse();
    expect(result.visitedFiles).toContain("app/public/forbidden.tsx");
    expect(result.visitedFiles).toContain("app/public/unauthorized.tsx");
    expect(result.violations.map((violation) => violation.rule)).toContain("db-source");
  });

});
