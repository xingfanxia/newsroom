import { describe, expect, test } from "bun:test";
import { readSource } from "@/tests/helpers/source";
import { sourceCatalog } from "@/lib/sources/catalog";
import {
  CATALOG_ORPHAN_SOURCE_NOTE,
  duplicateSourceCatalogIds,
  sourceCatalogIds,
} from "@/scripts/ops/seed-sources";

const seedSourcesScript = readSource("scripts/ops/seed-sources.ts");

describe("seed-sources catalog reconciliation", () => {
  test("catalog ids are unique and no longer include the legacy watchlist row", () => {
    expect(duplicateSourceCatalogIds()).toEqual([]);
    expect(sourceCatalogIds()).toHaveLength(sourceCatalog.length);
    expect(sourceCatalogIds()).not.toContain("x-ai-watchlist");
  });

  test("duplicate source ids are reported deterministically before DB work", () => {
    expect(
      duplicateSourceCatalogIds([
        { id: "z-source" },
        { id: "a-source" },
        { id: "z-source" },
        { id: "a-source" },
      ]),
    ).toEqual(["a-source", "z-source"]);
  });

  test("importing the script for tests cannot run the production seed", () => {
    expect(seedSourcesScript).toContain("if (import.meta.main)");
    expect(seedSourcesScript).toContain("await closeDb()");
    expect(seedSourcesScript).not.toContain("main().catch(");
  });

  test("db:seed disables enabled catalog-orphan rows instead of leaving pending fetch noise", () => {
    expect(CATALOG_ORPHAN_SOURCE_NOTE).toContain("lib/sources/catalog.ts");
    expect(seedSourcesScript).toContain("disableCatalogOrphanSources");
    expect(seedSourcesScript).toContain("notInArray(sources.id, catalogIds)");
    expect(seedSourcesScript).toContain("eq(sources.enabled, true)");
    expect(seedSourcesScript).toContain("refusing to disable sources with an empty source catalog");
  });
});
