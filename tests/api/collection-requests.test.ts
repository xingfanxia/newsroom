import { describe, expect, test } from "bun:test";
import {
  adminCollectionCreateBodySchema,
  adminCollectionUpdateBodySchema,
  collectionDeleteBodySchema,
  isDuplicateCollectionNameError,
  v1CollectionCreateBodySchema,
  v1CollectionUpdateBodySchema,
} from "@/lib/api/collection-requests";

describe("collection request schemas", () => {
  test("normalizes admin create bodies to the collection helper input shape", () => {
    expect(
      adminCollectionCreateBodySchema.parse({
        name: "Reading",
        nameCjk: "阅读",
      }),
    ).toEqual({
      name: "Reading",
      nameCjk: "阅读",
      pinned: false,
    });
  });

  test("normalizes v1 create bodies from snake_case to the helper input shape", () => {
    expect(
      v1CollectionCreateBodySchema.parse({
        name: "Reading",
        name_cjk: "阅读",
        pinned: true,
      }),
    ).toEqual({
      name: "Reading",
      nameCjk: "阅读",
      pinned: true,
    });
  });

  test("preserves update semantics while mapping the CJK key per surface", () => {
    expect(
      adminCollectionUpdateBodySchema.parse({
        id: 1,
        nameCjk: "",
      }).nameCjk,
    ).toBe("");
    expect(
      v1CollectionUpdateBodySchema.parse({
        id: 1,
        name_cjk: null,
      }).nameCjk,
    ).toBeUndefined();
  });

  test("validates shared delete bodies", () => {
    expect(collectionDeleteBodySchema.safeParse({ id: 1 }).success).toBe(true);
    expect(collectionDeleteBodySchema.safeParse({ id: 0 }).success).toBe(false);
  });

  test("detects duplicate collection errors consistently across surfaces", () => {
    expect(isDuplicateCollectionNameError(new Error("duplicate key"))).toBe(
      true,
    );
    expect(isDuplicateCollectionNameError("UNIQUE constraint failed")).toBe(
      true,
    );
    expect(isDuplicateCollectionNameError(new Error("network failed"))).toBe(
      false,
    );
  });
});
