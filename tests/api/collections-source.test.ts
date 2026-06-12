import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

const adminRoute = read("app/api/admin/collections/route.ts");
const v1Route = read("app/api/v1/collections/route.ts");

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
    expect(adminRoute).toContain("isDuplicateCollectionNameError");
    expect(v1Route).toContain("isDuplicateCollectionNameError");
    expect(adminRoute).not.toContain('msg.includes("duplicate")');
    expect(v1Route).not.toContain("/duplicate|unique/i");
  });
});
