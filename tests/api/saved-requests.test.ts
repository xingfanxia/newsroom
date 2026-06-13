import { describe, expect, test } from "bun:test";
import {
  feedbackMoveBodySchema,
  v1SavedPostBodySchema,
  v1SavedQuerySchema,
} from "@/lib/api/saved-requests";

describe("saved request schemas", () => {
  test("normalizes v1 saved query defaults and collection filters", () => {
    expect(v1SavedQuerySchema.parse({})).toEqual({
      limit: 80,
      locale: "en",
    });
    expect(
      v1SavedQuerySchema.parse({
        collection: "inbox",
        limit: "25",
        locale: "zh",
      }),
    ).toEqual({
      collection: "inbox",
      limit: 25,
      locale: "zh",
    });
    expect(v1SavedQuerySchema.parse({ collection: "42" }).collection).toBe(42);
  });

  test("rejects invalid v1 saved query bounds", () => {
    expect(v1SavedQuerySchema.safeParse({ collection: "0" }).success).toBe(
      false,
    );
    expect(v1SavedQuerySchema.safeParse({ limit: "201" }).success).toBe(false);
    expect(v1SavedQuerySchema.safeParse({ locale: "fr" }).success).toBe(false);
  });

  test("validates v1 saved mutation bodies", () => {
    expect(
      v1SavedPostBodySchema.parse({
        item_id: 10,
        on: true,
        collection_id: 2,
        note: "read later",
      }),
    ).toEqual({
      item_id: 10,
      on: true,
      collection_id: 2,
      note: "read later",
    });
    expect(
      v1SavedPostBodySchema.safeParse({ item_id: 0, on: true }).success,
    ).toBe(false);
    expect(
      v1SavedPostBodySchema.safeParse({
        item_id: 1,
        on: true,
        collection_id: 0,
      }).success,
    ).toBe(false);
  });

  test("validates saved move bodies while preserving inbox null", () => {
    expect(
      feedbackMoveBodySchema.parse({
        itemId: 10,
        targetCollectionId: null,
      }),
    ).toEqual({
      itemId: 10,
      targetCollectionId: null,
    });
    expect(
      feedbackMoveBodySchema.parse({
        itemId: 10,
        targetCollectionId: 3,
      }).targetCollectionId,
    ).toBe(3);
    expect(
      feedbackMoveBodySchema.safeParse({
        itemId: 10,
        targetCollectionId: 0,
      }).success,
    ).toBe(false);
  });
});
