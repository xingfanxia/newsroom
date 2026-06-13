import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const v1SourcesRoute = readFileSync(
  resolve(root, "app/api/v1/sources/route.ts"),
  "utf8",
);
const publicSourcesRoute = readFileSync(
  resolve(root, "app/api/public/sources/route.ts"),
  "utf8",
);
const sourcesPage = readFileSync(
  resolve(root, "app/[locale]/sources/page.tsx"),
  "utf8",
);
const schema = readFileSync(resolve(root, "db/schema.ts"), "utf8");
const types = readFileSync(resolve(root, "lib/types.ts"), "utf8");
const openapiRoute = readFileSync(
  resolve(root, "app/openapi.yaml/route.ts"),
  "utf8",
);

describe("source catalog source wiring", () => {
  test("public and v1 routes delegate source serialization to the shared module", () => {
    for (const source of [v1SourcesRoute, publicSourcesRoute]) {
      expect(source).toContain("@/lib/api/source-catalog");
      expect(source).toContain("listSourceCatalogRows");
      expect(source).not.toContain(".select({");
      expect(source).not.toContain("sourceHealth.");
    }
    expect(v1SourcesRoute).toContain("rows.map(toV1SourceApiItem)");
    expect(publicSourcesRoute).toContain("rows.map(toPublicSourceApiItem)");
  });

  test("OpenAPI documents the runtime source health enum", () => {
    expect(openapiRoute).toContain(
      "status: { type: string, enum: [ok, warning, error, pending] }",
    );
    expect(openapiRoute).not.toContain("enum: [ok, degraded, error, pending]");
  });

  test("source group/kind/cadence enums have one runtime source of truth", () => {
    expect(types).toContain("export const SOURCE_KINDS");
    expect(types).toContain("export const SOURCE_GROUPS");
    expect(types).toContain("export const CADENCES");
    expect(schema).toContain('pgEnum("source_kind", SOURCE_KINDS)');
    expect(schema).toContain('pgEnum("source_group", SOURCE_GROUPS)');
    expect(schema).toContain('pgEnum("cadence", CADENCES)');
  });

  test("sources page uses shared group order and labels", () => {
    expect(sourcesPage).toContain("@/lib/sources/groups");
    expect(sourcesPage).toContain("SOURCE_GROUPS");
    expect(sourcesPage).toContain("SOURCE_GROUP_LABELS");
    expect(sourcesPage).not.toContain("const GROUP_ORDER");
    expect(sourcesPage).not.toContain("const GROUP_LABELS");
  });
});
