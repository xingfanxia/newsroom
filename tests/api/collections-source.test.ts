import { describe, expect, test } from "bun:test";
import { readSource as read } from "@/tests/helpers/source";

const adminRoute = read("app/api/admin/collections/route.ts");
const v1Route = read("app/api/v1/collections/route.ts");
const sharedRouteHelper = read("lib/api/collection-routes.ts");

describe("collection route source wiring", () => {
  test("admin and v1 collection routes share request schemas", () => {
    for (const source of [adminRoute, v1Route]) {
      expect(source).toContain("@/lib/api/collection-requests");
      expect(source).not.toContain("const createSchema = z.object");
      expect(source).not.toContain("const updateSchema = z.object");
      expect(source).not.toContain("const deleteSchema = z.object");
    }
    expect(adminRoute).toContain("adminCollectionCreateBodySchema");
    expect(adminRoute).toContain("adminCollectionUpdateBodySchema");
    expect(v1Route).toContain("v1CollectionCreateBodySchema");
    expect(v1Route).toContain("v1CollectionUpdateBodySchema");
  });

  test("duplicate-name detection is centralized", () => {
    expect(sharedRouteHelper).toContain("isDuplicateCollectionNameError");
    expect(adminRoute).not.toContain("isDuplicateCollectionNameError");
    expect(v1Route).not.toContain("isDuplicateCollectionNameError");
    expect(adminRoute).not.toContain('msg.includes("duplicate")');
    expect(v1Route).not.toContain("/duplicate|unique/i");
  });

  test("admin and v1 routes share collection CRUD result mapping", () => {
    expect(sharedRouteHelper).toContain("@/lib/items/collections");
    expect(sharedRouteHelper).toContain("listCollectionRoutePayload");
    expect(sharedRouteHelper).toContain("createCollectionRoutePayload");
    expect(sharedRouteHelper).toContain("updateCollectionRoutePayload");
    expect(sharedRouteHelper).toContain("deleteCollectionRoutePayload");

    for (const source of [adminRoute, v1Route]) {
      expect(source).toContain("@/lib/api/collection-routes");
      expect(source).not.toContain("@/lib/items/collections");
      expect(source).not.toContain("result.error, result.status");
      expect(source).not.toContain("createCollection(");
      expect(source).not.toContain("listCollections(");
      expect(source).not.toContain("updateCollection(");
      expect(source).not.toContain("deleteCollection(");
    }

    expect(adminRoute).toContain("adminRouteResult(");
    expect(v1Route).toContain("v1RouteResult(");
  });
});
