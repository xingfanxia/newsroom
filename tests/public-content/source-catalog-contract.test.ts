import { describe, expect, test } from "bun:test";
import { publicSourceSchema } from "@/lib/public-content/contracts";
import { sourceCatalog } from "@/lib/sources/catalog";

describe("public source snapshot parity", () => {
  test("accepts the explicit public projection of every current source", () => {
    for (const source of sourceCatalog) {
      const projected = {
        schemaVersion: 1,
        id: source.id,
        name: source.name,
        url: source.url,
        kind: source.kind,
        group: source.group,
        locale: source.locale,
        cadence: source.cadence,
        priority: source.priority,
        tags: source.tags,
        enabled: source.enabled,
        curated: source.curated ?? false,
        health: {
          status: "pending",
          lastSuccessAt: null,
          consecutiveFailures: 0,
          totalItemsCount: 0,
        },
        itemCounts: { allTime: 0, last24h: 0 },
      };
      expect(publicSourceSchema.safeParse(projected).success, source.id).toBe(
        true,
      );
    }
  });
});
