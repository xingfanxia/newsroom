import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import {
  DB_OWNING_LOADER_SOURCES,
  checkSourcePublicDbBoundary,
} from "@/scripts/ops/check-public-db-boundary";
import {
  cleanupFixtureRoots,
  fixtureRoot,
  relativeImport,
  tursoDatabaseUrlKey,
  writeFixture,
} from "./public-db-boundary-fixtures";

afterEach(cleanupFixtureRoots);

describe("anonymous public DB boundary — source security", () => {
  test("rejects resolved local imports outside the root, including physical symlink escapes", () => {
    const root = fixtureRoot();
    const externalRoot = fixtureRoot();
    const outsideFile = join(externalRoot, "outside.ts");
    writeFixture(externalRoot, "outside.ts", "export const outside = true;\n");
    const entrypoint = join(root, "app/public/page.tsx");
    writeFixture(
      root,
      "app/public/page.tsx",
      `import { outside } from ${JSON.stringify(relativeImport(entrypoint, outsideFile))};\nimport { escaped } from "@/lib/escaped";\nexport default outside && escaped;\n`,
    );
    mkdirSync(join(root, "lib"), { recursive: true });
    symlinkSync(outsideFile, join(root, "lib/escaped.ts"));

    const result = checkSourcePublicDbBoundary({
      rootDir: root,
      entrypointSources: ["app/public/page.tsx"],
    });

    expect(result.ok).toBeFalse();
    expect(
      result.violations.filter((violation) => violation.rule === "unsafe-source-path"),
    ).toHaveLength(2);
  });

  test("denies every libsql package family in source imports", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      "app/public/page.tsx",
      'import "@libsql/hrana-client";\nimport "libsql";\nexport default function Page() {}\n',
    );

    const result = checkSourcePublicDbBoundary({
      rootDir: root,
      entrypointSources: ["app/public/page.tsx"],
    });

    expect(
      result.violations.filter((violation) => violation.rule === "libsql-client"),
    ).toHaveLength(2);
  });

  for (const extension of [".cts", ".cjs"] as const) {
    test(`follows CommonJS-family ${extension} modules to forbidden imports`, () => {
      const root = fixtureRoot();
      writeFixture(
        root,
        "app/public/page.tsx",
        `import { hidden } from "@/lib/hidden${extension}";\nexport default hidden;\n`,
      );
      writeFixture(
        root,
        `lib/hidden${extension}`,
        'import { createClient } from "@libsql/client";\nexport const hidden = createClient;\n',
      );

      const result = checkSourcePublicDbBoundary({
        rootDir: root,
        entrypointSources: ["app/public/page.tsx"],
      });

      expect(result.ok).toBeFalse();
      expect(result.violations.map((violation) => violation.rule)).toContain(
        "libsql-client",
      );
      expect(result.visitedFiles).toContain(`lib/hidden${extension}`);
    });
  }

  test("ignores Turso names in comments but rejects runtime identifiers, strings and properties", () => {
    const commentRoot = fixtureRoot();
    writeFixture(
      commentRoot,
      "app/public/page.tsx",
      `// ${tursoDatabaseUrlKey} is documentation only.\nexport default function Page() {}\n`,
    );
    expect(
      checkSourcePublicDbBoundary({
        rootDir: commentRoot,
        entrypointSources: ["app/public/page.tsx"],
      }).ok,
    ).toBeTrue();

    const runtimeRoot = fixtureRoot();
    writeFixture(
      runtimeRoot,
      "app/public/page.tsx",
      `const ${tursoDatabaseUrlKey} = "${tursoDatabaseUrlKey}";\nexport default process.env.${tursoDatabaseUrlKey} ?? ${tursoDatabaseUrlKey};\n`,
    );
    expect(
      checkSourcePublicDbBoundary({
        rootDir: runtimeRoot,
        entrypointSources: ["app/public/page.tsx"],
      }).violations.map((violation) => violation.rule),
    ).toContain("turso-secret");
  });

  test("rejects Turso secret names in imported JSON runtime data", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      "app/public/page.tsx",
      'import config from "@/data/config.json";\nexport default config;\n',
    );
    writeFixture(
      root,
      "data/config.json",
      JSON.stringify({ [tursoDatabaseUrlKey]: "forbidden-runtime-value" }),
    );

    const result = checkSourcePublicDbBoundary({
      rootDir: root,
      entrypointSources: ["app/public/page.tsx"],
    });
    expect(result.violations.map((violation) => violation.rule)).toContain(
      "turso-secret",
    );
  });

  test("keeps the DB-owning-loader boundary list synchronized with real files", () => {
    expect(DB_OWNING_LOADER_SOURCES).toBeArray();
    expect(DB_OWNING_LOADER_SOURCES.length).toBeGreaterThan(0);
    for (const loader of DB_OWNING_LOADER_SOURCES) {
      expect(existsSync(join(process.cwd(), loader))).toBeTrue();
    }
  });

  test("treats the root not-found source as a page with implicit ancestors", () => {
    const root = fixtureRoot();
    writeFixture(root, "app/not-found.tsx", "export default function NotFound() { return null; }\n");
    writeFixture(root, "app/layout.tsx", 'import { db } from "@/db/client";\nexport default function Layout({ children }: { children: unknown }) { db; return children; }\n');
    writeFixture(root, "db/client.ts", "export const db = {};\n");

    const result = checkSourcePublicDbBoundary({
      rootDir: root,
      entrypointSources: ["app/not-found.tsx"],
    });
    expect(result.contaminatedEntrypoints).toEqual(["app/not-found.tsx"]);
    expect(result.visitedFiles).toContain("app/layout.tsx");
  });

  test("fails unresolved tsconfig path aliases closed", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          module: "esnext",
          moduleResolution: "bundler",
          paths: { "~/*": ["lib/*"] },
        },
      }),
    );
    writeFixture(root, "app/public/page.tsx", 'import "~/missing";\nexport default function Page() {}\n');

    const result = checkSourcePublicDbBoundary({
      rootDir: root,
      entrypointSources: ["app/public/page.tsx"],
    });
    expect(result.violations.map((violation) => violation.rule)).toContain(
      "unresolved-internal-import",
    );
  });

  test("follows runtime namespace GET exports into the DB graph", () => {
    const root = fixtureRoot();
    writeFixture(root, "app/api/namespace/route.ts", 'export * as GET from "@/db/client";\n');
    writeFixture(root, "db/client.ts", "export const value = 1;\n");

    const result = checkSourcePublicDbBoundary({
      entrypointSources: ["app/api/namespace/route.ts"],
      rootDir: root,
    });

    expect(result.ok).toBeFalse();
    expect(result.violations.map(({ rule }) => rule)).toContain("db-source");
  });

  test("applies source ownership rules to an in-root symlink target", () => {
    const root = fixtureRoot();
    writeFixture(root, "app/public/page.tsx", 'import "@/lib/alias";\nexport default function Page() {}\n');
    writeFixture(root, "db/client.ts", "export const db = {};\n");
    mkdirSync(join(root, "lib"), { recursive: true });
    symlinkSync(join(root, "db/client.ts"), join(root, "lib/alias.ts"));

    const result = checkSourcePublicDbBoundary({
      entrypointSources: ["app/public/page.tsx"],
      rootDir: root,
    });

    expect(result.ok).toBeFalse();
    expect(
      result.violations.some(
        ({ file, rule }) => file === "db/client.ts" && rule === "db-source",
      ),
    ).toBeTrue();
  });

  test("applies package-family rules to an internally aliased physical target", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          module: "esnext",
          moduleResolution: "bundler",
          paths: { dbclient: ["node_modules/@libsql/client/index.js"] },
        },
      }),
    );
    writeFixture(root, "app/public/page.tsx", 'import "dbclient";\nexport default function Page() {}\n');
    writeFixture(root, "node_modules/@libsql/client/index.js", "export {};\n");

    const result = checkSourcePublicDbBoundary({
      entrypointSources: ["app/public/page.tsx"],
      rootDir: root,
    });

    expect(result.ok).toBeFalse();
    expect(result.violations.map(({ rule }) => rule)).toContain("libsql-client");
  });

});
