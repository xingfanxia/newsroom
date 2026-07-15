import { afterEach, describe, expect, test } from "bun:test";
import { checkSourcePublicDbBoundary } from "@/scripts/ops/check-public-db-boundary";
import {
  cleanupFixtureRoots,
  fixtureRoot,
  writeFixture,
} from "./public-db-boundary-fixtures";

afterEach(cleanupFixtureRoots);

describe("anonymous public DB boundary — parallel slots", () => {
  test("includes the matching nested route inside an ancestor parallel slot", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      "app/dashboard/settings/page.tsx",
      "export default function Page() {}\n",
    );
    writeFixture(
      root,
      "app/dashboard/@slot/settings/page.tsx",
      'import "@/db/client";\nexport default function Slot() {}\n',
    );
    writeFixture(root, "db/client.ts", "export const db = {};\n");

    const result = checkSourcePublicDbBoundary({
      entrypointSources: ["app/dashboard/settings/page.tsx"],
      rootDir: root,
    });

    expect(result.visitedFiles).toContain(
      "app/dashboard/@slot/settings/page.tsx",
    );
    expect(result.violations.map(({ rule }) => rule)).toContain("db-source");
  });

  test("matches parallel slot pages across different route-group directories", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      "app/dashboard/(main)/settings/page.tsx",
      "export default function Page() {}\n",
    );
    writeFixture(
      root,
      "app/dashboard/@slot/(side)/settings/page.tsx",
      'import "@/db/client";\nexport default function Slot() {}\n',
    );
    writeFixture(root, "db/client.ts", "export const db = {};\n");

    const result = checkSourcePublicDbBoundary({
      entrypointSources: ["app/dashboard/(main)/settings/page.tsx"],
      rootDir: root,
    });

    expect(result.visitedFiles).toContain(
      "app/dashboard/@slot/(side)/settings/page.tsx",
    );
    expect(result.violations.map(({ rule }) => rule)).toContain("db-source");
  });

  test("excludes slot-root page and default when a deeper normal page matches", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      "app/dashboard/(main)/settings/page.tsx",
      "export default function Settings() {}\n",
    );
    writeFixture(
      root,
      "app/dashboard/@slot/page.tsx",
      'import "@/db/root-page";\nexport default function RootPage() {}\n',
    );
    writeFixture(
      root,
      "app/dashboard/@slot/default.tsx",
      'import "@/db/root-default";\nexport default function Default() {}\n',
    );
    writeFixture(
      root,
      "app/dashboard/@slot/(side)/settings/page.tsx",
      'import "@/db/matched";\nexport default function Matched() {}\n',
    );
    writeFixture(root, "db/root-page.ts", "export const db = {};\n");
    writeFixture(root, "db/root-default.ts", "export const db = {};\n");
    writeFixture(root, "db/matched.ts", "export const db = {};\n");

    const result = checkSourcePublicDbBoundary({
      entrypointSources: ["app/dashboard/(main)/settings/page.tsx"],
      rootDir: root,
    });

    expect(result.visitedFiles).toContain(
      "app/dashboard/@slot/(side)/settings/page.tsx",
    );
    expect(result.visitedFiles).toContain("db/matched.ts");
    expect(result.visitedFiles).not.toContain("app/dashboard/@slot/page.tsx");
    expect(result.visitedFiles).not.toContain("app/dashboard/@slot/default.tsx");
    expect(result.visitedFiles).not.toContain("db/root-page.ts");
    expect(result.visitedFiles).not.toContain("db/root-default.ts");
    expect(result.violations.map(({ rule }) => rule)).toContain("db-source");
  });

  test("includes a named-slot default when no normal slot page matches", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      "app/dashboard/settings/page.tsx",
      "export default function Settings() {}\n",
    );
    writeFixture(
      root,
      "app/dashboard/@slot/page.tsx",
      'import "@/db/root-page";\nexport default function RootPage() {}\n',
    );
    writeFixture(
      root,
      "app/dashboard/@slot/default.tsx",
      "export default function Default() {}\n",
    );
    writeFixture(
      root,
      "app/dashboard/@slot/layout.tsx",
      'import "@/db/fallback-layout";\nexport default function Layout({ children }: { children: unknown }) { return children; }\n',
    );
    writeFixture(root, "db/root-page.ts", "export const db = {};\n");
    writeFixture(root, "db/fallback-layout.ts", "export const db = {};\n");

    const result = checkSourcePublicDbBoundary({
      entrypointSources: ["app/dashboard/settings/page.tsx"],
      rootDir: root,
    });

    expect(result.visitedFiles).toContain("app/dashboard/@slot/default.tsx");
    expect(result.visitedFiles).toContain("app/dashboard/@slot/layout.tsx");
    expect(result.visitedFiles).toContain("db/fallback-layout.ts");
    expect(result.visitedFiles).not.toContain("app/dashboard/@slot/page.tsx");
    expect(result.visitedFiles).not.toContain("db/root-page.ts");
    expect(result.violations.map(({ rule }) => rule)).toContain("db-source");
  });

  test("includes implicit children default for a slot-only request path", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      "app/default.tsx",
      'import "@/db/fallback";\nexport default function Default() {}\n',
    );
    writeFixture(
      root,
      "app/@slot/news/page.tsx",
      "export default function NewsSlot() {}\n",
    );
    writeFixture(root, "db/fallback.ts", "export const db = {};\n");

    const result = checkSourcePublicDbBoundary({
      entrypointSources: ["app/@slot/news/page.tsx"],
      rootDir: root,
    });

    expect(result.visitedFiles).toContain("app/default.tsx");
    expect(result.visitedFiles).toContain("db/fallback.ts");
    expect(result.violations.map(({ rule }) => rule)).toContain("db-source");
  });

  test("uses the matching implicit children page instead of its default", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      "app/default.tsx",
      'import "@/db/fallback";\nexport default function Default() {}\n',
    );
    writeFixture(
      root,
      "app/news/page.tsx",
      'import "@/db/main";\nexport default function News() {}\n',
    );
    writeFixture(
      root,
      "app/@slot/news/page.tsx",
      "export default function NewsSlot() {}\n",
    );
    writeFixture(root, "db/fallback.ts", "export const db = {};\n");
    writeFixture(root, "db/main.ts", "export const db = {};\n");

    const result = checkSourcePublicDbBoundary({
      entrypointSources: ["app/@slot/news/page.tsx"],
      rootDir: root,
    });

    expect(result.visitedFiles).toContain("app/news/page.tsx");
    expect(result.visitedFiles).toContain("db/main.ts");
    expect(result.visitedFiles).not.toContain("app/default.tsx");
    expect(result.visitedFiles).not.toContain("db/fallback.ts");
    expect(result.violations.map(({ rule }) => rule)).toContain("db-source");
  });

  test("evaluates nested slots without treating them as outer children matches", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      "app/settings/page.tsx",
      "export default function Settings() {}\n",
    );
    writeFixture(
      root,
      "app/@outer/layout.tsx",
      "export default function Outer({ children }: { children: unknown }) { return children; }\n",
    );
    writeFixture(
      root,
      "app/@outer/default.tsx",
      'import "@/db/outer-default";\nexport default function Default() {}\n',
    );
    writeFixture(
      root,
      "app/@outer/@inner/settings/page.tsx",
      'import "@/db/inner-page";\nexport default function Inner() {}\n',
    );
    writeFixture(root, "db/outer-default.ts", "export const db = {};\n");
    writeFixture(root, "db/inner-page.ts", "export const db = {};\n");

    const result = checkSourcePublicDbBoundary({
      entrypointSources: ["app/settings/page.tsx"],
      rootDir: root,
    });

    expect(result.visitedFiles).toContain("app/@outer/default.tsx");
    expect(result.visitedFiles).toContain("db/outer-default.ts");
    expect(result.visitedFiles).toContain(
      "app/@outer/@inner/settings/page.tsx",
    );
    expect(result.visitedFiles).toContain("db/inner-page.ts");
    expect(result.violations.map(({ rule }) => rule)).toContain("db-source");
  });

  test("resolves implicit children for every enclosing nested slot", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      "app/news/page.tsx",
      'import "@/db/main";\nexport default function News() {}\n',
    );
    writeFixture(
      root,
      "app/default.tsx",
      'import "@/db/root-fallback";\nexport default function Default() {}\n',
    );
    writeFixture(
      root,
      "app/@outer/default.tsx",
      "export default function OuterDefault() {}\n",
    );
    writeFixture(
      root,
      "app/@outer/@inner/news/page.tsx",
      "export default function InnerNews() {}\n",
    );
    writeFixture(root, "db/main.ts", "export const db = {};\n");
    writeFixture(root, "db/root-fallback.ts", "export const db = {};\n");

    const result = checkSourcePublicDbBoundary({
      entrypointSources: ["app/@outer/@inner/news/page.tsx"],
      rootDir: root,
    });

    expect(result.visitedFiles).toContain("app/news/page.tsx");
    expect(result.visitedFiles).toContain("db/main.ts");
    expect(result.visitedFiles).not.toContain("app/default.tsx");
    expect(result.visitedFiles).not.toContain("db/root-fallback.ts");
    expect(result.violations.map(({ rule }) => rule)).toContain("db-source");
  });

  test("uses root implicit children default for a nested slot-only path", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      "app/default.tsx",
      'import "@/db/root-fallback";\nexport default function Default() {}\n',
    );
    writeFixture(
      root,
      "app/@outer/default.tsx",
      "export default function OuterDefault() {}\n",
    );
    writeFixture(
      root,
      "app/@outer/@inner/news/page.tsx",
      "export default function InnerNews() {}\n",
    );
    writeFixture(root, "db/root-fallback.ts", "export const db = {};\n");

    const result = checkSourcePublicDbBoundary({
      entrypointSources: ["app/@outer/@inner/news/page.tsx"],
      rootDir: root,
    });

    expect(result.visitedFiles).toContain("app/default.tsx");
    expect(result.visitedFiles).toContain("db/root-fallback.ts");
    expect(result.violations.map(({ rule }) => rule)).toContain("db-source");
  });

  test("matches an intercepting modal slot to its canonical request pathname", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      "app/photo/[id]/page.tsx",
      "export default function Photo() {}\n",
    );
    writeFixture(
      root,
      "app/@modal/(.)photo/[id]/page.tsx",
      'import "@/db/client";\nexport default function Modal() {}\n',
    );
    writeFixture(
      root,
      "app/@modal/default.tsx",
      'import "@/db/fallback";\nexport default function Default() {}\n',
    );
    writeFixture(root, "db/client.ts", "export const db = {};\n");
    writeFixture(root, "db/fallback.ts", "export const db = {};\n");

    const result = checkSourcePublicDbBoundary({
      entrypointSources: ["app/photo/[id]/page.tsx"],
      rootDir: root,
    });

    expect(result.visitedFiles).toContain(
      "app/@modal/(.)photo/[id]/page.tsx",
    );
    expect(result.visitedFiles).toContain("app/@modal/default.tsx");
    expect(result.violations.map(({ rule }) => rule)).toContain("db-source");
  });
});
