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
});
