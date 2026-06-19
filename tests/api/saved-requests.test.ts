import { describe, expect, test } from "bun:test";
import {
  feedbackMoveBodySchema,
  parseV1SavedQueryRequest,
  v1SavedPostBodySchema,
  v1SavedQuerySchema,
} from "@/lib/api/saved-requests";
import {
  DEFAULT_SAVED_ITEMS_LIMIT,
  DEFAULT_SAVED_ITEMS_LOCALE,
  SAVED_ITEMS_LIMIT_MAX,
  SAVED_ITEMS_LIMIT_MIN,
} from "@/lib/saved/query-defaults";

describe("saved request schemas", () => {
  test("exposes the saved query defaults", () => {
    expect(SAVED_ITEMS_LIMIT_MIN).toBe(1);
    expect(SAVED_ITEMS_LIMIT_MAX).toBe(200);
    expect(DEFAULT_SAVED_ITEMS_LIMIT).toBe(80);
    expect(DEFAULT_SAVED_ITEMS_LOCALE).toBe("en");
  });

  test("normalizes v1 saved query defaults and collection filters", () => {
    expect(v1SavedQuerySchema.parse({})).toEqual({
      limit: DEFAULT_SAVED_ITEMS_LIMIT,
      locale: DEFAULT_SAVED_ITEMS_LOCALE,
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
    expect(
      v1SavedQuerySchema.safeParse({
        limit: String(SAVED_ITEMS_LIMIT_MAX + 1),
      }).success,
    ).toBe(false);
    expect(v1SavedQuerySchema.safeParse({ locale: "fr" }).success).toBe(false);
  });

  test("parses v1 saved query requests through the shared request helper", () => {
    const parsed = parseV1SavedQueryRequest(
      new Request(
        "https://example.test/api/v1/saved?collection=inbox&limit=25&locale=zh",
      ),
    );

    expect(parsed).toEqual({
      ok: true,
      data: {
        collection: "inbox",
        limit: 25,
        locale: "zh",
      },
    });

    const invalid = parseV1SavedQueryRequest(
      new Request(
        `https://example.test/api/v1/saved?limit=${SAVED_ITEMS_LIMIT_MAX + 1}`,
      ),
    );

    expect(invalid.ok).toBe(false);
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
