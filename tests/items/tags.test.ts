import { describe, expect, test } from "bun:test";
import { flattenItemTags } from "@/lib/items/tags";

describe("flattenItemTags", () => {
  test("flattens item tag axes in UI display order", () => {
    expect(
      flattenItemTags(
        {
          topics: ["Product update"],
          entities: ["OpenAI"],
          capabilities: ["Agent"],
        },
        10,
      ),
    ).toEqual(["Agent", "OpenAI", "Product update"]);
  });

  test("honors the caller-provided display cap", () => {
    expect(
      flattenItemTags(
        {
          capabilities: ["Agent", "RAG"],
          entities: ["OpenAI", "Anthropic"],
          topics: ["Product update"],
        },
        4,
      ),
    ).toEqual(["Agent", "RAG", "OpenAI", "Anthropic"]);
  });

  test("tolerates malformed DB JSON without leaking non-string cells", () => {
    expect(
      flattenItemTags(
        {
          capabilities: ["Agent", 42, null],
          entities: "OpenAI",
          topics: ["Product update", { label: "Funding" }],
          extra: ["ignored"],
        },
        10,
      ),
    ).toEqual(["Agent", "Product update"]);
    expect(flattenItemTags(null, 10)).toEqual([]);
    expect(flattenItemTags(["Agent"], 10)).toEqual([]);
  });

  test("returns no tags for a non-positive cap", () => {
    expect(flattenItemTags({ capabilities: ["Agent"] }, 0)).toEqual([]);
    expect(flattenItemTags({ capabilities: ["Agent"] }, -1)).toEqual([]);
  });
});
